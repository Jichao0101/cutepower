---
name: using-cutepower
description: Entry skill for cutepower P0. Use it to parse task profile, resolve the route from the routing table, emit a handoff package, and summarize gate requirements. Do not use it as a rule source or policy document.
---

# 1 Goal

Route the task into the P0 skill chain without copying governance text.

# 2 Contracts

- `task-normalization`
- `routing-table`
- `gate-matrix`
- `contract-index`

# 3 Workflow

1. Normalize the natural-language task into a `task_profile`, including inferred `primary_type`, `task_modifiers`, and execution-context gaps.
2. Run intake/preflight before direct execution, including `route_resolution`, `context_requirements`, `blocking_gaps`, and `runtime_gate`.
3. Resolve the matching `route_id`.
4. Emit the next skill handoff.
5. Emit the gate summary.

# 4 Entry Notes

- Prefer the `task-normalization` contract instead of requiring the user to hand-author a full structured prompt.
- Do not hard-jump to a concrete downstream skill from keywords alone.
- If route resolution or required execution context is still missing, stop at intake/preflight and surface the blocking gaps instead of silently bypassing cutepower.

# 5 Do Not Do

- Do not restate role contracts.
- Do not restate review boundaries.
- Do not restate writeback levels.
