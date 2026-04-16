---
name: using-cutepower
description: Entry skill for cutepower P0. Use it to parse task profile, resolve the route from the routing table, emit a handoff package, and summarize gate requirements. Do not use it as a rule source or policy document.
---

# 1 Goal

Route the task into the P0 skill chain without copying governance text.

# 2 Contracts

- `routing-table`
- `gate-matrix`
- `contract-index`

# 3 Workflow

1. Parse `primary_type` and `task_modifiers`.
2. Resolve the matching `route_id`.
3. Emit the next skill handoff.
4. Emit the gate summary.

# 4 Do Not Do

- Do not restate role contracts.
- Do not restate review boundaries.
- Do not restate writeback levels.
