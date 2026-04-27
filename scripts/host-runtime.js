'use strict';

const path = require('path');

const { readArtifact, runRoot } = require('./run-artifacts');
const {
  buildRuntimeGate,
  ensureSessionId,
  resolveWorkspaceRoot,
} = require('./task-intake');

function isManagedCutepowerRoute(routeId) {
  return Boolean(routeId && routeId !== 'declined_general_execution');
}

function tryResolveWorkspaceRoot(input = {}) {
  try {
    return resolveWorkspaceRoot(input);
  } catch (_error) {
    return null;
  }
}

function readPersistedRuntimeGate(input = {}) {
  const sessionId = input.session_id || input.sessionId || null;
  const workspaceRoot = tryResolveWorkspaceRoot(input);
  if (!sessionId || !workspaceRoot) {
    return null;
  }
  try {
    return readArtifact(path.join(workspaceRoot, '.cutepower'), sessionId, 'runtime_gate');
  } catch (_error) {
    return null;
  }
}

function buildSessionCapability(hostRuntime) {
  if (!hostRuntime || hostRuntime.runtime_gate_status !== 'ready' || !hostRuntime.managed_by_cutepower) {
    return null;
  }
  return {
    session_id: hostRuntime.session_id,
    route_id: hostRuntime.route_id,
    phase: hostRuntime.phase,
    capability: hostRuntime.capability,
    allowed_actions: hostRuntime.allowed_actions || [],
    required_artifacts: hostRuntime.required_preflight_outputs || [],
    issued_by: 'cutepower_host_runtime',
  };
}

function validateSessionCapability(hostRuntime, capability) {
  if (!capability || typeof capability !== 'object') {
    return {
      valid: false,
      reason: 'current_session_missing_valid_capability',
    };
  }
  if (capability.session_id !== hostRuntime.session_id) {
    return {
      valid: false,
      reason: 'session_capability_session_id_mismatch',
    };
  }
  if (capability.route_id !== hostRuntime.route_id || capability.capability !== hostRuntime.capability) {
    return {
      valid: false,
      reason: 'session_capability_route_or_capability_mismatch',
    };
  }
  return {
    valid: true,
    reason: 'session_capability_valid',
  };
}

function buildHostRuntime(input = {}) {
  const runtimeGate = input.runtime_gate || input.host_runtime?.runtime_gate || readPersistedRuntimeGate(input) || (
    input.route_id || input.allowed_actions || input.allowed_paths || input.capability
      ? {}
      : buildRuntimeGate(input)
  );
  const route = runtimeGate.route_resolution || {};
  const routeId = route.route_id || input.route_id || null;
  const capability = runtimeGate.capability || input.capability || null;
  const workspaceRoot = tryResolveWorkspaceRoot(input);
  const sessionId = ensureSessionId(input);
  const requiredPreflightOutputs = runtimeGate.required_preflight_outputs || input.required_preflight_outputs || [
    'task_profile',
    'route_resolution',
    'dispatch_manifest',
    'runtime_gate',
  ];
  return {
    session_id: sessionId,
    workspace_root: workspaceRoot,
    artifact_root: workspaceRoot ? path.join(workspaceRoot, '.cutepower') : null,
    artifact_dir: workspaceRoot ? runRoot(path.join(workspaceRoot, '.cutepower'), sessionId) : null,
    route_id: routeId,
    phase: runtimeGate.phase || route.phase || input.phase || 'intake',
    capability,
    allowed_actions: runtimeGate.allowed_actions || input.allowed_actions || [],
    allowed_paths: runtimeGate.allowed_paths || input.allowed_paths || [],
    evidence_collection_mode: runtimeGate.evidence_collection_mode || input.evidence_collection_mode || null,
    required_preflight_outputs: requiredPreflightOutputs,
    managed_by_cutepower: isManagedCutepowerRoute(routeId) || Boolean(capability),
    runtime_gate_status: runtimeGate.status || input.runtime_gate_status || null,
    runtime_gate: Object.keys(runtimeGate).length > 0 ? runtimeGate : null,
    session_capability: input.session_capability || input.host_runtime?.session_capability || null,
    action_guard: {
      explicit_mode: runtimeGate.task_profile
        ? runtimeGate.task_profile.explicit_mode
        : input.explicit_mode !== false,
      review_independence_model: 'procedural',
      writeback_closure_model: 'authority_bounded',
      executor_identity_separation_enforced: false,
    },
  };
}

function coerceHostRuntime(input = {}) {
  if (input.host_runtime) {
    return buildHostRuntime(input.host_runtime);
  }
  return buildHostRuntime(input);
}

module.exports = {
  buildHostRuntime,
  buildSessionCapability,
  coerceHostRuntime,
  isManagedCutepowerRoute,
  readPersistedRuntimeGate,
  validateSessionCapability,
};
