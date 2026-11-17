// Generates one provider branch per SPDX license ID plus a `main` consumer that depends on all of them.
// Usage: node generate-repo.mjs [--only=ID,ID,...|--limit=N|--limit=all] [--no-push] [--prune]
// With no selection flag, only DEBUG_SET is generated. Run from inside the repo, on `main`.
import { execFileSync } from 'child_process';
import fs from 'fs';

const REPO_URL = 'github:lucasgonze/license-compliance-test-cases';
const SPDX_DATA = 'https://raw.githubusercontent.com/spdx/license-list-data/main/json';
const BATCH_SIZE = 50;

// Default selection while the generator is being debugged.
const DEBUG_SET = [
  'MIT', // Baseline: plain ID, nothing unusual.
  'GPL-2.0+', // "+" in the branch name and git ref, alias rewrite to "-plus", deprecated ID.
  '0BSD', // Starts with a digit, so the npm alias and import specifier start with one.
];

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const onlyArg = flag('only');
const limitArg = flag('limit');
if (onlyArg !== undefined && limitArg !== undefined) throw new Error('Use --only or --limit, not both.');
const limit = limitArg === undefined ? undefined : limitArg === 'all' ? Infinity : Number(limitArg);
if (limit !== undefined && !(limit > 0)) throw new Error(`Invalid --limit: ${limitArg}`);
const only = onlyArg !== undefined ? onlyArg.split(',').filter(Boolean) : limit === undefined ? DEBUG_SET : undefined;
const push = !args.includes('--no-push');
const prune = args.includes('--prune');

// execFileSync with an argv array: no shell, so SPDX IDs never need quoting.
const git = (...a) => execFileSync('git', a, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const gitOk = (...a) => { try { git(...a); return true; } catch { return false; } };
// Commits only when something is staged, so re-running on unchanged input adds no commits.
const commitIfChanged = (message) => {
  if (gitOk('diff', '--cached', '--quiet')) return false;
  git('commit', '-m', message);
  return true;
};

// "GPL-2.0" and "GPL-2.0+" must not collide; "+" becomes "-plus".
const toNpmAlias = (id) => id.toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9-~._]/g, '-');

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  return response.json();
};

// Provider branches recorded in a consumer package.json, i.e. the "#<ID>" of each dependency.
const providersIn = (packageJson) => Object.values(JSON.parse(packageJson).dependencies ?? {})
  .filter((spec) => spec.startsWith(`${REPO_URL}#`))
  .map((spec) => spec.slice(REPO_URL.length + 1));

async function generate() {
  if (git('rev-parse', '--abbrev-ref', 'HEAD').trim() !== 'main') throw new Error('Run from the main branch.');
  if (git('status', '--porcelain', '--untracked-files=no').trim()) {
    throw new Error('Tracked files have uncommitted changes; commit or stash them first.');
  }

  console.log('Fetching official SPDX license list...');
  const all = (await fetchJson(`${SPDX_DATA}/licenses.json`)).licenses;
  if (!Array.isArray(all) || all.length === 0) throw new Error('SPDX list is empty or malformed.');

  // Check every ID, not just the selection, so a collision surfaces before a full run.
  const seen = new Map();
  for (const { licenseId } of all) {
    const alias = toNpmAlias(licenseId);
    if (seen.has(alias)) throw new Error(`npm alias collision: ${seen.get(alias)} and ${licenseId} -> ${alias}`);
    seen.set(alias, licenseId);
  }

  let licenses;
  if (only) {
    const byId = new Map(all.map((lic) => [lic.licenseId, lic]));
    const unknown = only.filter((id) => !byId.has(id));
    if (unknown.length) throw new Error(`Not in the SPDX list: ${unknown.join(', ')}`);
    licenses = only.map((id) => byId.get(id));
  } else {
    licenses = all.slice(0, limit);
  }
  console.log(`Using ${licenses.length} of ${all.length} licenses: ${only ? only.join(', ') : `limit=${limitArg}`}.`);

  // Fetch license texts before touching any branch, so a network failure leaves the repo as it was.
  const texts = new Map();
  for (const { licenseId: id } of licenses) {
    const { licenseText } = await fetchJson(`${SPDX_DATA}/details/${encodeURIComponent(id)}.json`);
    if (!licenseText) throw new Error(`No license text for ${id}`);
    texts.set(id, licenseText.endsWith('\n') ? licenseText : `${licenseText}\n`);
  }

  // Stale = providers the deployed main depends on that this run no longer selects
  // (removed from SPDX, or outside a smaller selection).
  const selected = new Set(licenses.map((lic) => lic.licenseId));
  let deployed = [];
  if (gitOk('fetch', '--quiet', 'origin', 'main')) {
    // No package.json means no consumer has been deployed yet.
    if (gitOk('cat-file', '-e', 'FETCH_HEAD:package.json')) deployed = providersIn(git('show', 'FETCH_HEAD:package.json'));
  } else {
    console.warn('Could not fetch origin/main; skipping stale-branch detection.');
  }
  const stale = deployed.filter((id) => !selected.has(id));

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

      fs.writeFileSync('LICENSE', texts.get(id));
      fs.writeFileSync('README.md', `# ${id} Provider\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nLicensed under ${id}; see LICENSE.\n`);
      fs.writeFileSync('index.js', `export const text = "Lorem ipsum dolor sit amet...";\nexport const license = ${JSON.stringify(id)};\n`);
      fs.writeFileSync('package.json', `${JSON.stringify({
        name: `license-test-${alias}`,
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        license: id,
      }, null, 2)}\n`);

      // Explicit paths: never sweep in untracked files (AGENTS.md, node_modules, ...).
      git('add', 'LICENSE', 'README.md', 'index.js', 'package.json');
      commitIfChanged(`feat: sync ${id} provider package`);

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
  // Overwrite only the generated files; README.md, AGENTS.md, the skill, and other tracked files stay untouched.
  fs.writeFileSync('package.json', `${JSON.stringify({
    name: 'license-compliance-consumer',
    version: '1.0.0',
    type: 'module',
    description: 'Consumer app pulling the same repository from hundreds of branches to test license compliance.',
    dependencies,
  }, null, 2)}\n`);
  fs.writeFileSync('index.js', `${imports.join('\n')}\n\n${logs.join('\n')}\n`);

  git('add', 'package.json', 'index.js');
  commitIfChanged('feat: sync main massive multi-license consumer');

  if (stale.length) {
    console.warn(`Stale provider branches (deployed but not selected): ${stale.join(', ')}`);
    if (!prune) console.warn('Re-run with --prune to delete them locally and on origin.');
  }

  if (!push) {
    console.log('--no-push given; skipping push and pruning. Branches and main are committed locally.');
    return;
  }

  console.log('Pushing provider branches in batches...');
  for (let i = 0; i < branches.length; i += BATCH_SIZE) {
    console.log(`Pushing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(branches.length / BATCH_SIZE)}...`);
    // Provider branches are generated, orphan, and safe to overwrite.
    git('push', '--force', 'origin', ...branches.slice(i, i + BATCH_SIZE));
  }
  // main only gains commits, so no force is needed.
  git('push', 'origin', 'main');

  if (prune && stale.length) {
    console.log(`Pruning ${stale.length} stale provider branches...`);
    for (const id of stale) gitOk('branch', '-D', id);
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      // A branch already gone from origin makes push report an error; the rest are still deleted.
      if (!gitOk('push', 'origin', '--delete', ...stale.slice(i, i + BATCH_SIZE))) {
        console.warn('Some stale branches could not be deleted on origin; see the git output above.');
      }
    }
  }

  console.log('Generation and deployment complete.');
}

generate().catch((e) => { console.error(e); process.exit(1); });
