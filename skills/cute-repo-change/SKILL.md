---
name: cute-repo-change
description: Execute repo changes inside the dispatched governed scope and hand off to review or board validation.
---

# Goal

Make the minimum legal repo change for the current governed route.

# Contracts

- `gate-matrix`
- `role-contracts`
- `skill-route-matrix`

# When This Skill Is Legal

- Only when `dispatch_manifest.next_skill` is `cute-repo-change`.
- Only after scope planning has completed.

# Required Input Artifacts

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`
- `implementation_plan`

# Workflow

1. Read only the approved repo scope.
2. Apply the minimum code change required by the plan.
3. Run allowed verification for the route.
4. Prepare the evidence and handoff package for the next skill.

# Required Outputs

- `change_summary`
- `verification_result`
- `open_issues`
- `dispatch_manifest`

# Phase Exit / Next Skill

- Exit to `cute-board-run` when board validation is required.
- Otherwise exit to `cute-code-review`.

# Stop Conditions

- missing repo scope
- route or phase mismatch
- verification cannot run inside allowed actions

# Do Not Do

- Do not self-review.
- Do not perform writeback.
- Do not exceed approved repo scope.
