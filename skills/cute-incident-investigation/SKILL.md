---
name: cute-incident-investigation
description: Run cutepower P1 incident investigation from symptoms and artifacts, produce testable hypotheses, orchestrate reruns and probes, and route follow-up work without taking repo-write or final review authority.
---

# Contracts

- `role-contracts`
- `gate-matrix`
- `routing-table`
- `writeback-levels`

# Input

- `observed_symptoms`
- `artifact_inventory`
- `log_sources`
- `trigger_condition`
- `reproduction_confidence`
- `environment_fingerprint`
- `board_target` or `no_board_execution`
- `repo_scope`
- `verification_tier`

# Output

- `hypothesis_set`
- `evidence_gaps`
- `probe_plan`
- `rerun_summary`
- `route_decision`
- `next_required_skill`

# Workflow

1. Build hypotheses from symptoms and available artifacts.
2. Identify evidence gaps and the minimum rerun or probe path.
3. Use `cute-board-run` when reproduction or artifact recollection is required.
4. If debug-only repo instrumentation is needed, request `cute-repo-change`; do not write the repo directly.
5. Handoff to `cute-code-review` after any repo change, to `cute-functional-review` when behavior or interface adjudication is required, or to `cute-writeback` for low-level incident closure.

# Do Not Do

- Do not edit repository files directly.
- Do not declare a candidate fix as passed.
- Do not emit the final review decision.
- Do not choose a writeback level above what the writeback contract allows.
