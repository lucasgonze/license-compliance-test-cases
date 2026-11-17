---
name: license-compliance-test-cases-install
description: Generate and install the license-compliance-test-cases repo, which has one provider branch per SPDX license ID and a `main` consumer that imports them all. Use when asked to build, update, sync, or verify the license compliance test suite. Re-runnable; unchanged input adds no commits.
---

# license-compliance-test-cases-install

Target repository: `https://github.com/lucasgonze/license-compliance-test-cases`

`generate-repo.mjs` (in the repo root, next to this file) creates a provider branch for each SPDX ID and rebuilds the `main` consumer. Each provider branch holds a tiny ESM package plus a `LICENSE` file with the full SPDX license text. `main` depends on each one via `github:lucasgonze/license-compliance-test-cases#<ID>`.

## Selection (debugging phase)

With no selection flag, the script generates only the **debug set** (`DEBUG_SET` in the script):

| ID | Why it's included |
| --- | --- |
| `MIT` | Baseline with nothing unusual. |
| `GPL-2.0+` | `+` in the branch name and git ref, alias rewrite to `gpl-2.0-plus`, deprecated ID. |
| `0BSD` | Leading digit in the npm alias and import specifier. |

Pushes force-overwrite provider branches, so stay on the debug set until the process is proven.

- `--only=ID,ID,...` generates exactly those IDs. Unknown IDs abort the run.
- `--limit=N` generates the first N IDs of the SPDX list.
- `--limit=all` generates every ID (~740 branches). **Get explicit user confirmation first.**
- `--no-push` commits locally and skips all pushing and pruning.
- `--prune` deletes stale provider branches, locally and on origin. See below.

Start with `--no-push`, inspect the result, then push with the debug set.

### Stale branches

A provider branch is stale when the deployed `origin/main` depends on it but the current run doesn't select it. This happens when SPDX removes an ID or when a run selects fewer licenses than the last one. The script always lists stale branches. It deletes them only with `--prune` on a pushing run, after the new `main` (which no longer depends on them) has been pushed.

Don't combine `--prune` with the debug set after a full run unless you mean to delete ~737 branches.

## Step 1: Clone and prepare

1. `git clone https://github.com/lucasgonze/license-compliance-test-cases.git && cd license-compliance-test-cases`
2. Use Node.js 18 or higher (`node --version`). The script is `.mjs`, so ESM works without a `"type": "module"` package.json, including on Node 18.
3. Be on `main` with no uncommitted changes to tracked files. The script aborts otherwise.

## Step 2: Run the generator

```bash
node generate-repo.mjs --no-push   # dry run
git branch --list                  # expect MIT, GPL-2.0+, 0BSD and main
node generate-repo.mjs             # push the debug set
```

Known-fixed pitfalls, so don't reintroduce them:

- **Fetch URL:** a plain string. Never wrap it in markdown link syntax (`[url](url)`), which makes `fetch` throw.
- **Stray files:** provider commits use `git add LICENSE README.md index.js package.json`. Never `git add .`, which commits untracked `AGENTS.md`, `node_modules`, and so on.
- **ESM on older Node:** the script is `.mjs` and uses the global `fetch` (Node 18+).
- **Re-runs:** commits happen only when something is staged. Never add `--allow-empty`, which adds a commit to every branch on every run.
- **Attribution:** generated commits carry no `Co-Authored-By` trailer, because whoever runs the script authors them.
- **Main branch:** only the generated `package.json` and `index.js` are overwritten (the hand-written `README.md` is left alone). Nothing else on `main` is removed, and `main` is pushed without `--force`.
- **Network failures:** the SPDX list and every license text are fetched before any branch is touched.
- **Branch hygiene:** the script always returns to `main`, even on failure. If it dies partway, run `git checkout -f main`.
- **Collisions:** `GPL-2.0` and `GPL-2.0+` map to different npm aliases (`+` becomes `-plus`). The script checks the whole SPDX list and aborts on any alias collision. Import identifiers are index-based.

## Step 3: Verify and install

1. `git checkout main`
2. `npm install --maxsockets=3 --fetch-retries=5`. Low concurrency avoids hundreds of simultaneous `git clone`s and GitHub rate limits.
3. `node index.js`
4. Confirm it prints one `Loaded <ID> branch: ...` line per generated branch (3 with the debug set).

## Before using `--limit=all`

- Check that `npm install` resolves `github:...#GPL-2.0+` from GitHub. It works with a local `git+file:` remote, but `github:` refs are fetched as tarballs.
- Check on GitHub that the debug-set branches look right, including their `LICENSE` files.
- Expect ~740 license-text fetches and a push of ~740 branches in batches of 50.
