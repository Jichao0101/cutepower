# Runtime Enforcement

This document describes the current runtime enforcement layer for cutepower. It is not a separate truth source and should be read together with `contracts/` and `docs/skill-workflow-map.md`.

## Current model

cutepower now runs as:

- skill-first workflow discipline
- contracts-first truth
- runtime-gate enforcement

That means:

- `using-cutepower` is the mandatory dispatcher for governed work
- `task-intake` persists dispatcher and preflight artifacts under `.cutepower/run/<session_id>/`
- `host-runtime` issues a session capability tied to the routed session
- `runtime-gates` deny protected execution when capability, phase, required artifacts, or governed skill order do not match
- review/writeback independence is procedural and authority-bounded; this runtime does not create subagents or enforce executor identity separation

## Stable preflight artifacts

- `task_profile.json`
- `route_resolution.json`
- `dispatch_manifest.json`
- `runtime_gate.json`

## Stable closure artifacts

- `evidence_manifest.json`
- `review_decision.json` when review is required
- `writeback_receipt.json` or `writeback_declined.json` when writeback is required

## What runtime enforces

- session capability validity
- required preflight artifact existence
- route and phase admission
- read-only evidence collection constraints where applicable
- governed skill order through `dispatch_manifest.next_skill`
- legal terminal closure

Runtime does not enforce executor identity separation for review or writeback. It enforces stage order, role/action boundaries, required artifacts, and closure legality.

## What runtime does not replace

- `contracts/` as active governance truth
- `skills/` as the human-readable workflow discipline layer
- `README.md` and `docs/skill-workflow-map.md` as overview material

## Helper script

```bash
node scripts/run-artifacts.js status .cutepower/run/<session_id>
node scripts/run-artifacts.js write .cutepower/run/<session_id> evidence_manifest /path/to/evidence.json
```
