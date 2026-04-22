# Runtime Hardening

This repo now treats explicit `cutepower` runs as repo-local managed sessions under `.cutepower/run/<session_id>/`.

Key changes:

- `task-intake` allocates `session_id`, writes preflight artifacts, and exposes an `artifact_plan`.
- `host-runtime` issues a session capability tied to `session_id`, `route_id`, `phase`, `allowed_actions`, and `artifact_dir`.
- `runtime-gates` now deny protected execution when capability, phase, or required artifacts do not match.
- `codex-hooks` now default-deny unmapped tool events in explicit mode.
- `stop` now acts as a completion gate. Ready sessions must close with `evidence_manifest`, `review_decision` when review is required, and `writeback_receipt` or `writeback_declined` when writeback is required.

Run-state model:

- Session root: `.cutepower/run/<session_id>/`
- Session metadata: `session.json`
- Stable artifacts:
  - `task_profile.json`
  - `route_resolution.json`
  - `runtime_gate.json`
  - `context_requirements.json`
  - `blocking_gaps.json`
  - `evidence_manifest.json`
  - `review_decision.json`
  - `writeback_receipt.json`
  - `writeback_declined.json`

Phase model:

- `session_initialized`
- `intake_accepted`
- `route_resolved`
- `gate_ready`
- `review_active`
- `writeback_ready`
- `completed`
- `declined`
- `blocked`
- `clarification_required`

Helper script:

```bash
node scripts/run-artifacts.js status .cutepower/run/<session_id>
node scripts/run-artifacts.js write .cutepower/run/<session_id> evidence_manifest /path/to/evidence.json
```
