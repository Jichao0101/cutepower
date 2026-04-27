---
name: cute-code-review
description: Perform procedural repo review for the governed route and emit the review decision artifact.
---

# Goal

Provide role-bounded repo review without inheriting author authority. Independence here is procedural: this skill requires a separate review stage, minimum evidence, and reviewer-role boundaries; it does not imply that runtime automatically creates or verifies a separate executor identity.

# Contracts

- `review-boundaries`
- `role-contracts`
- `skill-route-matrix`

# When This Skill Is Legal

- Only when `dispatch_manifest.next_skill` is `cute-code-review`.
- Only after implementation evidence is available.

# Required Input Artifacts

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`
- review evidence package required by `review-boundaries`

# Workflow

1. Read the minimum evidence package for repo review.
2. Check changed files, verification results, and scope compliance.
3. Emit findings and a review decision.
4. Prepare handoff for writeback or blocked closure.

# Required Outputs

- `review_findings`
- `review_decision`
- `dispatch_manifest`

# Phase Exit / Next Skill

- Exit to `cute-writeback` only after a procedural review decision exists.

# Stop Conditions

- missing review package
- missing procedural review stage
- missing required evidence

# Do Not Do

- Do not edit the review target.
- Do not inherit full author context.
- Do not adjudicate writeback policy.
