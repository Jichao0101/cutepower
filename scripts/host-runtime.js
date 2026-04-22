'use strict';

const { buildRuntimeGate } = require('./task-intake');

function buildHostRuntime(input = {}) {
  const runtimeGate = input.runtime_gate || (
    input.route_id || input.allowed_actions || input.allowed_paths || input.capability
      ? {}
      : buildRuntimeGate(input)
  );
  const route = runtimeGate.route_resolution || {};
  return {
    session_id: input.session_id || input.sessionId || 'session-local',
    route_id: route.route_id || input.route_id || null,
    phase: runtimeGate.phase || route.phase || input.phase || 'intake',
    capability: runtimeGate.capability || input.capability || null,
    allowed_actions: runtimeGate.allowed_actions || input.allowed_actions || [],
    allowed_paths: runtimeGate.allowed_paths || input.allowed_paths || [],
    evidence_collection_mode: runtimeGate.evidence_collection_mode || input.evidence_collection_mode || null,
    required_preflight_outputs: runtimeGate.required_preflight_outputs || [
      'task_profile',
      'route_resolution',
      'runtime_gate',
    ],
    action_guard: {
      explicit_mode: runtimeGate.task_profile
        ? runtimeGate.task_profile.explicit_mode
        : input.explicit_mode !== false,
      reviewer_independence_required: true,
      writeback_independence_required: true,
    },
  };
}

function coerceHostRuntime(input = {}) {
  if (input.host_runtime) {
    return buildHostRuntime(input.host_runtime);
  }
  if (input.runtime_gate || input.route_id || input.allowed_actions) {
    return buildHostRuntime(input);
  }
  return buildHostRuntime({
    ...input,
    runtime_gate: buildRuntimeGate(input),
  });
}

module.exports = {
  buildHostRuntime,
  coerceHostRuntime,
};
