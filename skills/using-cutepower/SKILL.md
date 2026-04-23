---
name: using-cutepower
description: Mandatory dispatcher for governed cutepower work. Use it to normalize the task, resolve the route, persist preflight artifacts, and hand off to the next legal skill without copying contract text.
---

# Goal

Dispatch governed work into the legal skill chain and stop direct downstream entry.

# Contracts

- `task-normalization`
- `routing-table`
- `skill-route-matrix`
- `gate-matrix`

# When This Skill Is Legal

- Start here for any governed cutepower route.
- Use this before any protected execution skill.
- Allow fallback only when intake declines cutepower governance.

# Required Input Artifacts

- natural-language task request
- execution context that can produce `task_profile`

# Workflow

1. Build `task_profile` from the natural-language request.
2. Resolve `route_resolution` from contracts.
3. Run intake and persist `task_profile`, `route_resolution`, `dispatch_manifest`, and `runtime_gate`.
4. Emit the next legal skill and the required artifacts for that skill.
5. Stop if route resolution fails, required context is missing, or runtime gate is not ready.

# Required Outputs

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`

# Phase Exit / Next Skill

- Hand off only to `dispatch_manifest.next_skill`.
- Keep `using-cutepower` as `current_skill` until preflight is persisted.

# Stop Conditions

- `route_status != resolved`
- missing required execution context
- `runtime_gate.status != ready`

# Do Not Do

- Do not restate policy text from contracts.
- Do not jump directly into `cute-*` execution skills.
- Do not treat skill prose as enforcement.
