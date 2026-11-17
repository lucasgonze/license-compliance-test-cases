# license-compliance-test-cases

Test cases for license compliance tooling like FOSSA.

Given a tool for license compliance:
* Check all targeted languages, e.g. Rust, PHP, etc
* Check all targeted licenses, e.g. AGPL, GPL 2.0, etc

A user of this repository would clone it, add to their tooling, and verify that compliance issues were detected.

## Design

The repository tests license detection by making one repository contain many licenses:

- **Provider branches:** There is one orphan branch for each ID in the [SPDX license list](https://spdx.org/licenses/), named exactly by its SPDX ID (e.g. `MIT`, `GPL-2.0-only`, `AGPL-3.0-or-later`). Each holds a tiny ESM npm package whose `package.json` declares that license. The package has no history in common with any other branch.
- **Consumer branch:** `main` is an npm project that depends on every provider branch through a git dependency, `github:lucasgonze/license-compliance-test-cases#<SPDX ID>`. Each dependency is aliased to a lowercase npm-safe name, with `+` written as `-plus` so `GPL-2.0` and `GPL-2.0+` stay distinct.
- **Why one repo:** A compliance scanner pointed at `main` has to resolve hundreds of dependencies, each declaring a different license. The scanner's output can then be compared with the full SPDX list to see which licenses it detects and which it misses.

### Layout of `main`

| Path | Purpose |
| --- | --- |
| `generate-repo.mjs` | Generates the provider branches and the consumer files. |
| `SKILL.md` | Instructions for running the generator and verifying the result. It doubles as an agent skill. |
| `AGENTS.md`, `CLAUDE.md` | Entry points for AI agents. `CLAUDE.md` imports `AGENTS.md`, which points to `SKILL.md`. |
| `.claude/skills/` | Symlink that registers `SKILL.md` as a skill in Claude Code. |
| `package.json`, `index.js` | The consumer app. Generated, and absent until the generator has run. |
| `licenses/`, `platforms/` | Placeholders for sample licenses and for sample languages and package managers. They are empty so far. |

## How the generator works

`node generate-repo.mjs [--limit=N|all] [--no-push]`

1. Checks that you are on `main` and that no tracked files have uncommitted changes.
2. Fetches the current license list from [spdx/license-list-data](https://github.com/spdx/license-list-data).
3. For each license, creates or updates the provider branch and commits `README.md`, `index.js` and `package.json`. Only those three files are added.
4. Returns to `main`, rewrites `package.json` and `index.js` to depend on and import every provider, and commits.
5. Unless `--no-push` is given, force-pushes the provider branches in batches of 50, then pushes `main` without `--force`.

It is idempotent, so you can re-run it whenever the SPDX list changes. It aborts if two SPDX IDs map to the same npm name.

**Branch limit:** While the generator is being debugged, it processes only the first 3 licenses. `--limit=N` raises the cap. `--limit=all` removes it, which means about 700 force-pushed branches. Don't use it without deciding that is what you want.

## Usage

Requires Node.js 18 or higher.

```bash
git clone https://github.com/lucasgonze/license-compliance-test-cases.git
cd license-compliance-test-cases

node generate-repo.mjs --no-push   # build locally and inspect with `git branch --list`
node generate-repo.mjs             # build and push (3 licenses by default)

git checkout main
npm install --maxsockets=3 --fetch-retries=5
node index.js
```

The low socket count keeps npm from starting hundreds of simultaneous `git clone` processes, which can hit GitHub rate limits. `node index.js` should print one `Loaded <ID> branch: ...` line per provider.

To test a scanner, run it against `main` after `npm install` and check that each declared license is reported. See `SKILL.md` for the full procedure and known pitfalls.

## Status

The generator is still being proven out on 3 branches. Not yet checked:

- That npm resolves git refs containing `+`, such as `GPL-2.0+`, in a dependency's `#<ref>`.
- A full-scale run and install.
- The `licenses/` and `platforms/` samples. The language and package-manager side of the goals above is not built yet.
