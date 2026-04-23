---
name: cute-writeback
description: Close the governed route by applying the allowed writeback level after review or legal incident closure.
---

# Goal

Record the allowed closure outcome without widening writeback authority.

# Contracts

- `writeback-levels`
- `gate-matrix`
- `skill-route-matrix`

# When This Skill Is Legal

- Only when `dispatch_manifest.next_skill` is `cute-writeback`.
- Only after required review or legal incident closure conditions are met.

# Required Input Artifacts

- `task_profile`
- `route_resolution`
- `dispatch_manifest`
- `runtime_gate`
- `review_decision` when review is required

# Workflow

1. Read the route writeback level and closure preconditions.
2. Confirm required review or incident artifacts exist.
3. Write the legal writeback artifact or decline writeback.

# Required Outputs

- `files_written`
- `writeback_level`
- `remaining_risks`

# Phase Exit / Next Skill

- Exit only to terminal closure.

# Stop Conditions

- missing writeback preconditions
- route does not allow current writeback target
- independent adjudication not available

# Do Not Do

- Do not invent a higher writeback level.
- Do not replace runtime closure checks.
- Do not modify governance truth.
