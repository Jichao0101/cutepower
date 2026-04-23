# Skill Workflow Map

This document is a human-readable overview of the governed workflow layers.

Truth still lives in:

- `contracts/routing-table.yaml`
- `contracts/skill_route_matrix.yaml`
- `contracts/gate-matrix.yaml`

## Layers

1. `using-cutepower`
   Normalizes the task, resolves the route, persists preflight artifacts, and emits `dispatch_manifest`.
2. routed execution skill
   Reads `dispatch_manifest.next_skill` and performs only the legal work for that stage.
3. runtime gate
   Enforces capability, phase, artifact continuity, and governed skill order.

## Core Preflight Artifacts

- `task_profile.json`
- `route_resolution.json`
- `dispatch_manifest.json`
- `runtime_gate.json`

## Default Workflow Patterns

- implementation / bug fix:
  `using-cutepower -> cute-scope-plan -> cute-repo-change -> cute-code-review -> cute-writeback`
- read-only functional audit:
  `using-cutepower -> cute-scope-plan -> cute-functional-review -> cute-writeback`
- incident investigation:
  `using-cutepower -> cute-scope-plan -> cute-incident-investigation -> cute-writeback`

Board validation inserts `cute-board-run` where the route requires board evidence.
