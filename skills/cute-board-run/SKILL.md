---
name: cute-board-run
description: Bind board targets, execute board-side deploy and run commands, collect artifacts, and emit a reusable board evidence package for cutepower P1. Do not use it as a review, repo-change, or writeback authority.
---

# Contracts

- `gate-matrix`
- `role-contracts`
- `routing-table`

# Input

- `board_target`
- `deploy_artifacts`
- `run_commands`
- `collect_paths`
- `expected_signals`
- `timeout_policy`
- `reset_or_recovery_steps`
- `artifact_expectations`

# Output

- `board_run_report`
- `artifact_manifest`
- `signal_observations`
- `execution_status`
- `board_failure_reason`
- `environment_fingerprint`

# Do Not Do

- Do not determine root cause.
- Do not edit repository files.
- Do not emit code-review or functional-review decisions.
- Do not decide writeback level or closure.
