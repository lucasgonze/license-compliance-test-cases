// Integration tests: build the debug set locally, then check what `fossa analyze` reports offline.
// Run with: node --test test/        (needs network for the SPDX list, plus `fossa`, `git`, `npm` on PATH)
//
// Offline mode (`FOSSA_API_KEY=` and `--output`) reports the dependency graph only. License detection
// happens server-side after an upload, so these tests never upload and cannot assert detected licenses.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_URL = 'github:lucasgonze/license-compliance-test-cases';

// Explicit expectations, deliberately not derived from the generator's own alias function.
const CASES = [
  { id: 'MIT', slug: 'mit', alias: 'nop-mit', licenseText: /^MIT License/ },
  { id: 'GPL-2.0+', slug: 'gpl-2.0-plus', alias: 'nop-gpl-2.0-plus', licenseText: /GNU GENERAL PUBLIC LICENSE/ },
  { id: '0BSD', slug: '0bsd', alias: 'nop-0bsd', licenseText: /Permission to use, copy, modify/ },
  // Regression: the bare alias "zlib" is a Node built-in and made `import ... from 'zlib'` fail.
  { id: 'Zlib', slug: 'zlib', alias: 'nop-zlib', licenseText: /^zlib License/ },
];

const hasTool = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const missing = ['fossa', 'git', 'npm'].filter((t) => !hasTool(t));

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// Returns the parsed JSON that `fossa analyze --output` prints to stdout.
function fossaAnalyze(cwd) {
  const result = spawnSync('fossa', ['analyze', '--output', '--experimental-force-first-party-scans', '.'], {
    cwd,
    // An empty key keeps fossa from uploading anything.
    env: { ...process.env, FOSSA_API_KEY: '' },
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `fossa analyze failed:\n${result.stderr}`);
  return JSON.parse(result.stdout.toString());
}

describe('fossa analyze on generated output', { skip: missing.length ? `missing on PATH: ${missing.join(', ')}` : false, timeout: 300_000 }, () => {
  let tmp, scratch, originBare, consumer;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-fossa-')));
    scratch = path.join(tmp, 'scratch');
    fs.mkdirSync(scratch);
    // A fresh repo holding only the generator, so tests exercise the working copy rather than the last commit.
    fs.copyFileSync(path.join(ROOT, 'generate-repo.mjs'), path.join(scratch, 'generate-repo.mjs'));
    run('git', ['init', '-q', '-b', 'main'], scratch);
    run('git', ['add', 'generate-repo.mjs'], scratch);
    run('git', ['commit', '-q', '-m', 'test: generator'], scratch);

    run('node', ['generate-repo.mjs', `--only=${CASES.map((c) => c.id).join(',')}`, '--no-push'], scratch);

    // Stand-in for GitHub: a bare repo holding every generated branch.
    originBare = path.join(tmp, 'origin.git');
    run('git', ['clone', '-q', '--bare', scratch, originBare], tmp);

    consumer = path.join(tmp, 'consumer');
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'index.js'), run('git', ['show', 'main:index.js'], scratch));
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      run('git', ['show', 'main:package.json'], scratch).replaceAll(REPO_URL, `git+file://${originBare}`),
    );
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  describe('provider branches', () => {
    for (const { id, slug, licenseText } of CASES) {
      test(id, () => {
        run('git', ['checkout', '-q', id], scratch);
        try {
          assert.deepEqual(fs.readdirSync(scratch).filter((f) => f !== '.git').sort(), ['LICENSE', 'README.md', 'index.js', 'package.json']);
          const pkg = JSON.parse(fs.readFileSync(path.join(scratch, 'package.json'), 'utf8'));
          assert.equal(pkg.license, id);
          assert.equal(pkg.name, `license-test-${slug}`);
          assert.match(fs.readFileSync(path.join(scratch, 'LICENSE'), 'utf8'), licenseText);

          const out = fossaAnalyze(scratch);
          assert.equal(out.projects.length, 1);
          assert.equal(out.projects[0].type, 'npm');
          assert.deepEqual(out.projects[0].graph.deps, [], 'a provider has no dependencies');
          assert.deepEqual(out.sourceUnits[0].OriginPaths, ['package.json']);
          assert.equal(out.sourceUnits[0].Build.Succeeded, true);
        } finally {
          run('git', ['checkout', '-q', 'main'], scratch);
        }
      });
    }
  });

  describe('consumer', () => {
    test('before install: one git dependency per provider, ref preserved', () => {
      const deps = fossaAnalyze(consumer).projects[0].graph.deps;
      assert.deepEqual(
        deps.map((d) => d.name).sort(),
        CASES.map((c) => c.alias).sort(),
      );
      for (const { id, alias } of CASES) {
        const dep = deps.find((d) => d.name === alias);
        assert.ok(dep.version.value.endsWith(`#${id}`), `${alias} should keep ref #${id}, got ${dep.version.value}`);
      }
    });

    test('after install: complete graph with one npm locator per provider', () => {
      run('npm', ['install', '--no-audit', '--no-fund', '--maxsockets=3', '--fetch-retries=5'], consumer);
      const out = fossaAnalyze(consumer);

      const unit = out.sourceUnits[0];
      assert.equal(unit.GraphBreadth, 'complete');
      assert.deepEqual(unit.OriginPaths, ['package-lock.json']);
      assert.deepEqual(
        [...unit.Build.Imports].sort(),
        CASES.map((c) => `npm+${c.alias}$1.0.0`).sort(),
      );
    });

    test('node index.js loads every provider', () => {
      const lines = run('node', ['index.js'], consumer).trim().split('\n');
      assert.deepEqual(
        lines.map((l) => l.match(/^Loaded (\S+) branch:/)?.[1]),
        CASES.map((c) => c.id),
      );
    });
  });
});
