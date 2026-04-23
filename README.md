# 1 cutepower

cutepower is a plugin-first governance plugin built around skill-first workflow discipline, contracts-first truth, and runtime-gate enforcement.

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
- personal installs stage the plugin under `~/.codex/plugins/`; repo installs stage under `<repo-root>/plugins/`
- uninstall with `node scripts/uninstall-plugin.js --mode personal` or `node scripts/uninstall-plugin.js --mode repo --target-root <repo-root>` so the staged plugin copy and marketplace entry are cleaned together
- Do not treat a host knowledge repository as the code root for this project.

Current scope:

- active runtime assets live in the plugin
- core governance contracts live in `contracts/`
- skills provide workflow discipline and consume contracts instead of copying rule text
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
- `skills/` is the human-readable workflow discipline layer and consumes contracts instead of duplicating rule text
- `AGENTS.md` is a thin runtime bridge with hard stops
- `agents/*.toml` is a compatibility bridge, not a policy source
- `scripts/validate-contracts.js` provides static contract validation
- `scripts/task-profile.js` provides natural-language task normalization into a routed task profile
- `scripts/task-intake.js` provides the default-entry intake/preflight layer, acts as the dispatcher handoff point, allocates `session_id`, writes repo-local preflight artifacts under `.cutepower/run/<session_id>/`, and blocks takeover when the minimum preflight set cannot be established
- `contracts/skill_route_matrix.yaml` defines route-to-skill order, skill entry legality, and required handoff artifacts
- `scripts/host-runtime.js` provides host-side explicit-mode session-context injection, loads persisted runtime gate state, and issues session capabilities bound to `session_id`, `route_id`, `phase`, and `allowed_actions`
- `scripts/runtime-gates.js` provides action-front runtime admission checks for route, capability, phase, artifact existence, and governed skill order using repo-local run artifacts as the runtime source of truth
- `scripts/run-artifacts.js` manages repo-local run-state artifacts and schema validation
- `schemas/run-artifacts/` defines stable runtime artifact schemas
- `scripts/test-runtime-gates.js` provides positive and negative gate checks
- `scripts/test-task-profile.js` provides natural-language routing and safety checks
- `scripts/test-task-intake.js` provides default-entry takeover and fallback coverage

Current workflow and enforcement coverage:

- governed work now starts from the dispatcher skill `using-cutepower`
- intake now hard-stops when route resolution is unsupported, runtime gate is not ready, or the minimum preflight artifacts cannot be persisted
- runtime gate checks now hard-stop when session capability is missing/invalid, `runtime_gate.json` is missing, required preflight artifacts are absent, or the requested governed skill does not match `dispatch_manifest.next_skill`
- route/writeback requests are checked against `route_writeback_matrix`
- review-stage `board_execute` is rejected and board artifact collection is separately gated
- runtime requests reject legacy `reviewer` aliases
- repo-reviewer, functional-reviewer, and incident-investigator stay separated by route and action gates
- protected business execution, review, and writeback now require a host-issued session capability
- ready-state execution now depends on repo-local preflight artifacts instead of session-context hints alone
- governed skill handoff now depends on `dispatch_manifest.json`
- run completion depends on legal terminal state plus required closure artifacts:
  - `evidence_manifest`
  - `review_decision` when review is required
- functional review closure now requires a structured artifact chain:
  - `requirements_package`
  - `acceptance_items`
  - `evidence_plan`
  - `relevant_context`
  - `evidence_manifest`
  - `evidence_gaps`
  - `review_decision`
  - `compliance_matrix`
  - `writeback_receipt` or `writeback_declined` when writeback is required

Run-state model:

- repo-local run state lives under `.cutepower/run/<session_id>/`
- stable runtime artifacts include:
  - `task_profile.json`
  - `route_resolution.json`
  - `dispatch_manifest.json`
  - `runtime_gate.json`
  - `evidence_manifest.json`
  - `review_decision.json`
  - `writeback_receipt.json`
  - `writeback_declined.json`

Testing note:

- for clean plugin acceptance tests, prefer an isolated vault that contains only `.agents/plugins/marketplace.json` and an installed plugin copy under `plugins/cutepower`
- do not rely on another host workspace as the primary plugin test environment
- keep plugin validation focused on `contracts/`, `skills/`, `scripts/`, and thin bridge files

Validation entries:

```bash
node scripts/test-install-plugin.js
node scripts/test-uninstall-plugin.js
node scripts/test-host-runtime.js
node scripts/validate-contracts.js
node scripts/test-skill-routing.js
node scripts/test-skill-docs.js
node scripts/test-runtime-gates.js
node scripts/test-task-profile.js
node scripts/test-task-intake.js
node scripts/run-artifacts.js status .cutepower/run/<session_id>
```

Workflow map:

- dispatcher-first entry is `using-cutepower`
- governed route order lives in `contracts/routing-table.yaml` and `contracts/skill_route_matrix.yaml`
- human-readable workflow overview lives in [docs/skill-workflow-map.md](docs/skill-workflow-map.md)
- runtime enforcement detail lives in [docs/runtime-hardening.md](docs/runtime-hardening.md), which now describes current dispatcher/runtime enforcement rather than a separate hardening phase
