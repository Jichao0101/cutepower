---
name: cute-incident-investigation
description: Investigate governed incidents, produce route decisions, and hand off follow-up work without taking repo-write or final review authority.
---

# Goal

Produce a testable incident route decision and evidence plan.

# Contracts

- `role-contracts`
- `gate-matrix`
- `routing-table`
- `skill-route-matrix`

# When This Skill Is Legal

- Only when `dispatch_manifest.next_skill` is `cute-incident-investigation`.
- Only after scope planning has produced an investigation package.

# Required Input Artifacts

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`
- investigation package

# Workflow

1. Build hypotheses from symptoms and artifacts.
2. Identify the minimum probe or rerun path.
3. Route to board evidence, repo change, functional review, or writeback as needed.
4. Update the handoff package with the next required skill.

# Required Outputs

- `hypothesis_set`
- `evidence_gaps`
- `probe_plan`
- `route_decision`
- `dispatch_manifest`

# Phase Exit / Next Skill

- Exit to the next routed skill declared by the investigation decision.

# Stop Conditions

- missing initial evidence
- missing route decision
- unresolved probe scope

# Do Not Do

- Do not edit repository files directly.
- Do not emit final review decisions.
- Do not choose a writeback level above contract allowance.
