---
name: cute-functional-review
description: Perform independent functional review against routed requirements and evidence packages.
---

# Goal

Adjudicate functional compliance using the minimum legal evidence package.

# Contracts

- `review-boundaries`
- `role-contracts`
- `gate-matrix`
- `skill-route-matrix`

# When This Skill Is Legal

- Only when `dispatch_manifest.next_skill` is `cute-functional-review`.
- Only after routed requirements and evidence are available.

# Required Input Artifacts

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`
- functional review evidence package

# Workflow

1. Read the minimum functional review package.
2. Validate requirements coverage and evidence sufficiency.
3. Emit `compliance_matrix`, `evidence_gaps`, and `review_decision`.
4. Handoff to writeback or blocked closure.

# Required Outputs

- `compliance_matrix`
- `evidence_used`
- `evidence_gaps`
- `review_decision`
- `dispatch_manifest`

# Phase Exit / Next Skill

- Exit to `cute-writeback` only after a legal review conclusion exists.

# Stop Conditions

- missing requirements package
- evidence insufficient for decision
- missing independent review stage

# Do Not Do

- Do not edit repository files.
- Do not replace repo review.
- Do not declare pass from execution alone.
