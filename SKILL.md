---
name: license-compliance-test-cases-install
description: Generate and install the license-compliance-test-cases repo, which has one provider branch per SPDX license ID and a `main` consumer that imports them all. Use when asked to build, update, sync, or verify the license compliance test suite. Idempotent; safe to re-run as the SPDX list changes.
---

# license-compliance-test-cases-install

Target repository: `https://github.com/lucasgonze/license-compliance-test-cases`

`generate-repo.mjs` (in the repo root, next to this file) creates a provider branch for each SPDX ID and rebuilds the `main` consumer. Provider branches hold a tiny ESM package. `main` depends on each one via `github:lucasgonze/license-compliance-test-cases#<ID>`.

## Branch limit (debugging phase)

The script processes **only the first 3 licenses by default**. Pushes force-overwrite provider branches, so keep this limit until the process is proven.

- `--limit=N` sets a different cap.
- `--limit=all` removes it (~700 branches). **Get explicit user confirmation first.**
- `--no-push` commits locally and skips all pushes.

Start with `--no-push`, inspect the result, then push with the default limit.

## Step 1: Clone and prepare

1. `git clone https://github.com/lucasgonze/license-compliance-test-cases.git && cd license-compliance-test-cases`
2. Use Node.js 18 or higher (`node --version`). The script is `.mjs`, so ESM works without a `"type": "module"` package.json, including on Node 18.
3. Be on `main` with no uncommitted changes to tracked files. The script aborts otherwise.

## Step 2: Run the generator

```bash
node generate-repo.mjs --no-push   # dry run
git branch --list                                                                       # expect 3 provider branches + main
node generate-repo.mjs             # push (limit 3)
```

Known-fixed pitfalls, so don't reintroduce them:

- **Fetch URL:** a plain string. Never wrap it in markdown link syntax (`[url](url)`), which makes `fetch` throw.
- **Stray files:** provider commits use `git add README.md index.js package.json`. Never `git add .`, which commits untracked `AGENTS.md`, `node_modules`, and so on.
- **ESM on older Node:** the script is `.mjs` and uses the global `fetch` (Node 18+).
- **Main branch:** only the generated `package.json` and `index.js` are overwritten (the hand-written `README.md` is left alone). Nothing else on `main` is removed, and `main` is pushed without `--force`.
- **Branch hygiene:** the script always returns to `main`, even on failure. If it dies partway, run `git checkout -f main`.
- **Collisions:** `GPL-2.0` and `GPL-2.0+` map to different npm aliases (`+` becomes `-plus`). The script aborts on any alias collision. Import identifiers are index-based.

## Step 3: Verify and install

1. `git checkout main`
2. `npm install --maxsockets=3 --fetch-retries=5`. Low concurrency avoids hundreds of simultaneous `git clone`s and GitHub rate limits.
3. `node index.js`
4. Confirm it prints one `Loaded <ID> branch: ...` line per generated branch (3 with the default limit).

## Before using `--limit=all`

- Check that IDs containing `+` work in the `#<ref>` of a git dependency during `npm install`. The 3-branch run won't exercise this.
- Check on GitHub that the first 3 branches look right.
- Expect a push of ~700 branches in batches of 50.
