# license-compliance-test-cases

Test cases for license compliance tooling like FOSSA.

Given a tool for license compliance:
* Check all targeted languages, e.g. Rust, PHP, etc
* Check all targeted licenses, e.g. AGPL, GPL 2.0, etc

A user of this repository would clone it, add to their tooling, and verify that compliance issues were detected.

## Design

The repository tests license detection by making one repository contain many licenses:

- **Provider branches:** There is one orphan branch for each ID in the [SPDX license list](https://spdx.org/licenses/), named exactly by its SPDX ID (e.g. `MIT`, `GPL-2.0-only`, `AGPL-3.0-or-later`). Each holds a tiny ESM npm package whose `package.json` declares that license, plus a `LICENSE` file with the full license text from SPDX. Scanners can therefore be tested on both declared licenses and license-text detection. The package has no history in common with any other branch.
- **Consumer branch:** `main` is an npm project that depends on every provider branch through a git dependency, `github:lucasgonze/license-compliance-test-cases#<SPDX ID>`. Each dependency is aliased to a lowercase npm-safe name, with `+` written as `-plus` so `GPL-2.0` and `GPL-2.0+` stay distinct.
- **Why one repo:** A compliance scanner pointed at `main` has to resolve hundreds of dependencies, each declaring a different license. The scanner's output can then be compared with the full SPDX list to see which licenses it detects and which it misses.

### Layout of `main`

| Path | Purpose |
| --- | --- |
| `generate-repo.mjs` | Generates the provider branches and the consumer files. |
| `SKILL.md` | Instructions for running the generator and verifying the result. It doubles as an agent skill. |
| `AGENTS.md`, `CLAUDE.md` | Entry points for AI agents. `CLAUDE.md` imports `AGENTS.md`, which points to `SKILL.md`. |
| `.claude/skills/license-compliance-test-cases-install/SKILL.md` | Symlink to `SKILL.md` that registers it as a skill in Claude Code. |
| `.gitignore` | Keeps `node_modules/` and `package-lock.json` from `npm install` out of git. |
| `test/` | Integration tests that run `fossa analyze` offline on the generated output. |
| `package.json`, `index.js` | The consumer app. Generated, and absent until the generator has run. |
| `licenses/`, `platforms/` | Placeholders for sample licenses and for sample languages and package managers. They are empty so far. |

## How the generator works

`node generate-repo.mjs [--only=ID,ID,...|--limit=N|--limit=all] [--no-push] [--prune]`

1. Checks that you are on `main` and that no tracked files have uncommitted changes.
2. Fetches the current license list and the text of each selected license from [spdx/license-list-data](https://github.com/spdx/license-list-data).
3. For each license, creates or updates the provider branch with `LICENSE`, `README.md`, `index.js` and `package.json`. Only those four files are added.
4. Returns to `main`, rewrites `package.json` and `index.js` to depend on and import every provider.
5. Unless `--no-push` is given, force-pushes the provider branches in batches of 50, then pushes `main` without `--force`.
6. Lists stale provider branches: ones the deployed `origin/main` depends on that this run doesn't select. With `--prune`, deletes them locally and on origin.

It commits only when a file actually changed, so re-running on an unchanged SPDX list adds no commits. It aborts if two SPDX IDs map to the same npm name.

**Debug set:** While the generator is being debugged, a run with no selection flag generates only `MIT` (a baseline), `GPL-2.0+` (a `+` in the ref and a deprecated ID) and `0BSD` (a leading digit). `--only=ID,...` picks specific IDs, and `--limit=N` takes the first N of the SPDX list. `--limit=all` generates every ID, which means about 740 force-pushed branches. Don't use it without deciding that is what you want.

## Usage

Requires Node.js 18 or higher.

```bash
git clone https://github.com/lucasgonze/license-compliance-test-cases.git
cd license-compliance-test-cases

node generate-repo.mjs --no-push   # build locally and inspect with `git branch --list`
node generate-repo.mjs             # build and push the debug set

git checkout main
npm install --maxsockets=3 --fetch-retries=5
node index.js
```

The low socket count keeps npm from starting hundreds of simultaneous `git clone` processes, which can hit GitHub rate limits. `node index.js` should print one `Loaded <ID> branch: ...` line per provider.

To test a scanner, run it against `main` after `npm install` and check that each declared license is reported. See `SKILL.md` for the full procedure and known pitfalls.

## Tests

```bash
node --test test/fossa.integration.test.mjs
```

The test builds the debug set in a temporary repo and runs `fossa analyze --output` with an empty `FOSSA_API_KEY`, so nothing is uploaded. Offline output has the dependency graph but no license findings, so the tests check the provider contents, the graph FOSSA resolves for `main`, and `node index.js`. See `SKILL.md` for the registry-lookup caveat.

## Status

The generator is still being proven out on the debug set. It has been run end to end against a local git remote, including `npm install` and `node index.js` with `GPL-2.0+`. Not yet checked:

- That npm resolves `github:` refs containing `+`, such as `#GPL-2.0+`, from GitHub.
- A full-scale run and install.
- The `licenses/` and `platforms/` samples. The language and package-manager side of the goals above is not built yet.
