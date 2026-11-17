// Generates one provider branch per SPDX license ID plus a `main` consumer that depends on all of them.
// Usage: node generate-repo.mjs [--limit=N|all] [--no-push]
// Default limit is 3 while the script is being debugged. Run from inside the repo, on `main`.
import { execFileSync } from 'child_process';
import fs from 'fs';

const REPO_URL = 'github:lucasgonze/license-compliance-test-cases';
const SPDX_URL = 'https://raw.githubusercontent.com/spdx/license-list-data/main/json/licenses.json';
const DEFAULT_LIMIT = 3;
const BATCH_SIZE = 50;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
const limit = limitArg === 'all' ? Infinity : limitArg ? Number(limitArg) : DEFAULT_LIMIT;
if (!(limit > 0)) throw new Error(`Invalid --limit: ${limitArg}`);
const push = !args.includes('--no-push');

// execFileSync with an argv array: no shell, so SPDX IDs never need quoting.
const git = (...a) => execFileSync('git', a, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const gitOk = (...a) => { try { git(...a); return true; } catch { return false; } };

// "GPL-2.0" and "GPL-2.0+" must not collide; "+" becomes "-plus".
const toNpmAlias = (id) => id.toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9-~._]/g, '-');

async function generate() {
  if (git('rev-parse', '--abbrev-ref', 'HEAD').trim() !== 'main') throw new Error('Run from the main branch.');
  if (git('status', '--porcelain', '--untracked-files=no').trim()) {
    throw new Error('Tracked files have uncommitted changes; commit or stash them first.');
  }

  console.log('Fetching official SPDX license list...');
  const response = await fetch(SPDX_URL);
  if (!response.ok) throw new Error(`SPDX fetch failed: ${response.status} ${response.statusText}`);
  const all = (await response.json()).licenses;
  if (!Array.isArray(all) || all.length === 0) throw new Error('SPDX list is empty or malformed.');

  const licenses = all.slice(0, limit);
  console.log(`Using ${licenses.length} of ${all.length} licenses${limit === Infinity ? '' : ` (limit=${limit})`}.`);

  const seen = new Map();
  for (const { licenseId } of licenses) {
    const alias = toNpmAlias(licenseId);
    if (seen.has(alias)) throw new Error(`npm alias collision: ${seen.get(alias)} and ${licenseId} -> ${alias}`);
    seen.set(alias, licenseId);
  }

  const dependencies = {};
  const imports = [];
  const logs = [];
  const branches = [];

  try {
    licenses.forEach(({ licenseId: id }, i) => {
      const alias = toNpmAlias(id);
      console.log(`Generating branch: ${id}`);

      if (gitOk('show-ref', '--verify', '--quiet', `refs/heads/${id}`)) git('checkout', id);
      else git('checkout', '--orphan', id);
      // Fails harmlessly when the index is already empty.
      gitOk('rm', '-rf', '.');

      fs.writeFileSync('README.md', `# ${id} Provider\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.\n`);
      fs.writeFileSync('index.js', `export const text = "Lorem ipsum dolor sit amet...";\nexport const license = ${JSON.stringify(id)};\n`);
      fs.writeFileSync('package.json', JSON.stringify({
        name: `license-test-${alias}`,
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        license: id,
      }, null, 2));

      // Explicit paths: never sweep in untracked files (AGENTS.md, node_modules, ...).
      git('add', 'README.md', 'index.js', 'package.json');
      git('commit', '--allow-empty', '-m', `feat: sync ${id} provider package\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`);

      branches.push(id);
      dependencies[alias] = `${REPO_URL}#${id}`;
      // Index-based identifiers cannot collide the way sanitized names can.
      imports.push(`import { text as text_${i}, license as lic_${i} } from '${alias}';`);
      logs.push(`console.log(\`Loaded \${lic_${i}} branch: \${text_${i}.substring(0, 15)}...\`);`);
    });
  } finally {
    // Always return to main, even if a provider branch failed.
    git('checkout', '-f', 'main');
  }

  console.log('Rebuilding main consumer files...');
  // Overwrite only the generated files; AGENTS.md, the skill, and other tracked files stay untouched.
  fs.writeFileSync('package.json', JSON.stringify({
    name: 'license-compliance-consumer',
    version: '1.0.0',
    type: 'module',
    description: 'Consumer app pulling the same repository from hundreds of branches to test license compliance.',
    dependencies,
  }, null, 2));
  fs.writeFileSync('index.js', `${imports.join('\n')}\n\n${logs.join('\n')}\n`);
  fs.writeFileSync('README.md', '# Massive License Compliance Test\n\nRun `npm install` then `node index.js` to test all SPDX branches.\n');

  git('add', 'package.json', 'index.js', 'README.md');
  git('commit', '--allow-empty', '-m', 'feat: sync main massive multi-license consumer\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>');

  if (!push) {
    console.log('--no-push given; skipping push. Branches and main are committed locally.');
    return;
  }

  console.log('Pushing provider branches in batches...');
  for (let i = 0; i < branches.length; i += BATCH_SIZE) {
    console.log(`Pushing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(branches.length / BATCH_SIZE)}...`);
    // Provider branches are generated, orphan, and safe to overwrite.
    git('push', '--force', 'origin', ...branches.slice(i, i + BATCH_SIZE));
  }
  // main only gains a commit, so no force is needed.
  git('push', 'origin', 'main');

  console.log('Generation and deployment complete.');
}

generate().catch((e) => { console.error(e); process.exit(1); });
