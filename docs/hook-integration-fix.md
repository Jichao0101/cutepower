# Codex Hook Integration Fix

## Problem diagnosis

- `UserPromptSubmit` and `Stop` were emitting mixed textual output instead of a stable JSON object.
- Explicit `cutepower` mode treated normal evidence reads as generic `business_context_read`, then denied them before a read-only audit route was usable.
- Strict read-only functional audit had no minimal capability/phase/action contract for requirements and code evidence collection.
- Blocked reviews were not terminalizable, so stop could not close a run when evidence collection failed for runtime reasons.

## Minimal fix strategy

- Force every hook handler to emit one stable JSON object through `emitHookResponse()`.
- Split read intents into `runtime_discovery_read`, `authorized_business_context_read`, and `forbidden_business_context_read`.
- Add an explicit route for strict read-only functional audit with `evidence_collection` phase and controlled `allowed_actions`.
- Treat blocked review as a first-class terminal state with `evidence_manifest.status=blocked`, `review_decision.decision=blocked`, `writeback_declined`, and `terminal_phase=blocked_closed`.

## Scope

- No external services.
- No contracts-first bypass.
- No blanket read allow.
- No reviewer or writeback boundary relaxation.
