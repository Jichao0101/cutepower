---
name: cute-functional-review
description: Perform independent functional compliance review for cutepower P1 against requirements, acceptance items, interface contracts, and runtime behavior evidence. Keep reviewer independence and minimal evidence package boundaries explicit.
---

# Contracts

- `review-boundaries`
- `role-contracts`
- `gate-matrix`

# Input

- `requirements_package`
- `acceptance_items`
- `interface_contracts`
- `evidence_package`
- `board_target` or `no_board_execution`
- `relevant_code_context`

# Output

- `compliance_matrix`
- `evidence_used`
- `evidence_gaps`
- `review_conclusion`
- `suggested_followup`

# Workflow

1. Review only the minimum evidence package required by `functional_review`.
2. If runtime behavior evidence is missing and board evidence is required, call `cute-board-run` only for evidence collection.
3. Emit `pass`, `rework_required`, `blocked`, or `evidence_gap` based on the contract.

# Do Not Do

- Do not edit repository files.
- Do not replace `cute-code-review`.
- Do not inherit coder or investigator full context.
- Do not declare pass solely because code runs.
