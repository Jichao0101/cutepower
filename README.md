# 1 cutepower

cutepower is a plugin-first, contracts-first governance plugin for the Agent Workflow P1 loop.

This README is the installed-plugin overview.

Installation entry:

- Before installation, use [README.codex.md](README.codex.md) and [.codex/INSTALL.md](.codex/INSTALL.md).
- cutepower is now expected to live at the repository root as an independent project.
- Do not treat a host knowledge repository as the code root for this project.

Current scope:

- active runtime assets live in the plugin
- core governance contracts live in `contracts/`
- skills consume contracts instead of copying rule text
- `AGENTS.md` and `agents/*.toml` stay as thin bridge layers
- external design docs and project baselines are not active truth sources
- P0 skills remain active:
  - `using-cutepower`
  - `cute-scope-plan`
  - `cute-repo-change`
  - `cute-code-review`
  - `cute-writeback`
- P1 skills now include:
  - `cute-board-run`
  - `cute-functional-review`
  - `cute-incident-investigation`

Current non-goals:

- P2 skills
- complex hooks
- automatic runtime hook enforcement
- automatic remediation

Installed-plugin boundaries:

- `contracts/` is the active governance truth source
- `skills/` consumes contracts instead of duplicating rule text
- `AGENTS.md` is a thin runtime bridge with hard stops
- `agents/*.toml` is a compatibility bridge, not a policy source
- `scripts/validate-contracts.js` provides static contract validation
- `scripts/runtime-gates.js` provides a minimal runtime gate evaluator for route, role, review, and writeback requests
- `scripts/test-runtime-gates.js` provides positive and negative gate checks

Runtime hardening coverage:

- route/writeback requests are checked against `route_writeback_matrix`
- review-stage `board_execute` is rejected and board artifact collection is separately gated
- runtime requests reject legacy `reviewer` aliases
- repo-reviewer, functional-reviewer, and incident-investigator stay separated by route and action gates

Testing note:

- for clean plugin acceptance tests, prefer an isolated vault that contains only `.agents/plugins/marketplace.json` and a link to this repository root
- do not rely on another host workspace as the primary plugin test environment
- keep plugin validation focused on `contracts/`, `skills/`, `scripts/`, and thin bridge files

Validation entries:

```bash
node scripts/validate-contracts.js
node scripts/test-runtime-gates.js
```
