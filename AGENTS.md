# Agent Instructions: Massive Multi-License Self-Consuming Repository

This repository (`lucasgonze/license-compliance-test-cases`) is a license compliance test suite. It has one provider branch for every SPDX license ID and a single `main` consumer branch that imports them all.

All build, update, and verification instructions live in the skill:

`SKILL.md` (repo root)

The generator script sits next to it as `generate-repo.mjs`.

The generator is limited to 3 branches by default. Do not use `--limit=all` without explicit user confirmation.
