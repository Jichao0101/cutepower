---
name: cute-board-run
description: Execute board-side evidence collection for governed routes without taking repo, review, or writeback authority.
---

# Goal

Collect board evidence for the routed workflow.

# Contracts

- `gate-matrix`
- `role-contracts`
- `routing-table`
- `skill-route-matrix`

# When This Skill Is Legal

- Only when `dispatch_manifest.next_skill` is `cute-board-run`.
- Only for routes that require board execution or board artifact collection.

# Required Input Artifacts

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`
- board execution package

# Workflow

1. Bind the legal board target and run package.
2. Execute the allowed board steps for evidence collection.
3. Collect artifacts and summarize observed signals.
4. Handoff to the next routed review or closure skill.

# Required Outputs

- `board_run_report`
- `artifact_manifest`
- `signal_observations`
- `execution_status`
- `dispatch_manifest`

# Phase Exit / Next Skill

- Exit to the next skill declared by the route workflow, typically review.

# Stop Conditions

- missing board target
- missing run commands
- invalid collection paths

# Do Not Do

- Do not edit repository files.
- Do not emit final review decisions.
- Do not choose writeback level.
