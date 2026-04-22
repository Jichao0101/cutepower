# 1 cutepower

cutepower is a plugin-first, contracts-first governance plugin for the Agent Workflow P1 loop.

This README is the runtime-plugin overview after the plugin has been installed from `/plugins`.

## Codex Quick Start

If cutepower is not installed yet, tell Codex:

```text
Fetch and follow instructions from .codex/INSTALL.md
```

Important distinction:

- `node scripts/install-plugin.js ...`
  - stages a local plugin copy and writes a marketplace entry so `cutepower` is discoverable and installable from `/plugins`

After the script finishes, open `/plugins`, search `cutepower`, and choose `Install Plugin`. Re-run the script only when you intentionally update or replace the staged plugin source.

Installation entry:

- Before installation, use [README.codex.md](README.codex.md) and [.codex/INSTALL.md](.codex/INSTALL.md).
- the git repository is the development source; the runtime should consume an installed copy.
- preferred installation is `node scripts/install-plugin.js --mode personal`
- repo-scoped installation is `node scripts/install-plugin.js --mode repo --target-root <repo-root>`
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
- automatic remediation

Installed-plugin boundaries:

- `contracts/` is the active governance truth source
- `skills/` consumes contracts instead of duplicating rule text
- `AGENTS.md` is a thin runtime bridge with hard stops
- `agents/*.toml` is a compatibility bridge, not a policy source
- `scripts/validate-contracts.js` provides static contract validation
- `scripts/host-runtime.js` provides the host-side explicit-mode session-context injection package and action-guard bridge
- `scripts/runtime-gates.js` provides action-front runtime admission checks for route, role, review, and writeback requests
- `scripts/task-profile.js` provides natural-language task normalization into a routed task profile
- `scripts/task-intake.js` provides the default-entry intake/preflight layer for route resolution, blocking gaps, runtime discovery, and skill handoff
- `scripts/test-runtime-gates.js` provides positive and negative gate checks
- `scripts/test-task-profile.js` provides natural-language routing and safety checks
- `scripts/test-task-intake.js` provides default-entry takeover and fallback coverage

Runtime hardening coverage:

- route/writeback requests are checked against `route_writeback_matrix`
- review-stage `board_execute` is rejected and board artifact collection is separately gated
- runtime requests reject legacy `reviewer` aliases
- repo-reviewer, functional-reviewer, and incident-investigator stay separated by route and action gates

Testing note:

- for clean plugin acceptance tests, prefer an isolated vault that contains only `.agents/plugins/marketplace.json` and an installed plugin copy under `plugins/cutepower`
- do not rely on another host workspace as the primary plugin test environment
- keep plugin validation focused on `contracts/`, `skills/`, `scripts/`, and thin bridge files

Validation entries:

```bash
node scripts/test-install-plugin.js
node scripts/test-host-runtime.js
node scripts/validate-contracts.js
node scripts/test-runtime-gates.js
node scripts/test-task-profile.js
node scripts/test-task-intake.js
```
