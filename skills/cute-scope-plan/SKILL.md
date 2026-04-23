---
name: cute-scope-plan
description: Build the governed scope package for cutepower tasks before implementation, review, or writeback starts.
---

# Goal

Turn the dispatched route into a bounded plan package.

# Contracts

- `routing-table`
- `skill-route-matrix`
- `gate-matrix`

# When This Skill Is Legal

- After `using-cutepower` dispatches to `cute-scope-plan`.
- Before repo change, functional review, incident investigation, or board execution.

# Required Input Artifacts

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`

# Workflow

1. Read the route and allowed path scope.
2. Produce the minimum implementation or review plan for the current route.
3. Confirm verification tier and open uncertainties.
4. Update the handoff package for the next skill.

# Required Outputs

- `implementation_plan`
- `verification_plan`
- `verification_tier`
- `dispatch_manifest`

# Phase Exit / Next Skill

- Exit to the next skill declared by the route-specific workflow.

# Stop Conditions

- missing governed preflight artifacts
- insufficient scope to plan legal work
- route requires context that is still absent

# Do Not Do

- Do not edit repo files.
- Do not emit review decisions.
- Do not choose writeback level.
