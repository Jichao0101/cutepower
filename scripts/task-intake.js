'use strict';

function normalizeTaskProfile(input = {}) {
  const prompt = String(input.prompt || input.user_prompt || '').toLowerCase();
  const explicitMode = input.explicit_mode !== false;
  const requestedAudit = /functional audit|read-only audit|readonly audit|read only audit/.test(prompt)
    || input.audit_mode === 'functional_read_only';
  const readOnlyRequested = /read-only|readonly|read only/.test(prompt)
    || input.evidence_collection_mode === 'read_only';
  const requestedIntegrationFix = /hook integration fix|codex hook integration fix|integration defect|runtime defect|修复|改造/.test(prompt)
    || input.task_type === 'hook_integration_fix';

  return {
    primary_type: requestedAudit
      ? 'functional_audit'
      : requestedIntegrationFix
        ? 'hook_integration_fix'
        : 'general_task',
    task_modifiers: requestedAudit
      ? ['read_only', 'strict']
      : requestedIntegrationFix
        ? ['implementation', 'verification']
        : [],
    explicit_mode: explicitMode,
    requested_capability: requestedAudit && readOnlyRequested
      ? 'functional_audit_read_only'
      : requestedIntegrationFix
        ? 'hook_integration_fix'
        : 'unknown',
    requested_outputs: ['task_profile', 'route_resolution', 'runtime_gate'],
  };
}

function extractAuthorization(input = {}) {
  const authorization = input.authorization || {};
  const supplemental = input.supplemental_authorization || {};
  const mergedPaths = [
    ...(authorization.allowed_paths || []),
    ...(supplemental.allowed_paths || []),
  ];

  return {
    user_explicitly_authorized: Boolean(
      authorization.user_explicitly_authorized
      || supplemental.user_explicitly_authorized
      || input.user_explicitly_authorized
    ),
    project_paths_authorized: Boolean(
      authorization.project_paths_authorized
      || supplemental.project_paths_authorized
      || input.project_paths_authorized
    ),
    container_access_authorized: Boolean(
      authorization.container_access_authorized
      || supplemental.container_access_authorized
      || input.container_access_authorized
    ),
    evidence_collection_mode: supplemental.evidence_collection_mode
      || authorization.evidence_collection_mode
      || input.evidence_collection_mode
      || null,
    allowed_paths: Array.from(new Set(mergedPaths)),
  };
}

function resolveRoute(taskProfile, authorization) {
  if (
    taskProfile.explicit_mode
    && taskProfile.requested_capability === 'hook_integration_fix'
  ) {
    return {
      route_id: 'explicit_hook_integration_fix',
      phase: 'implementation',
      allowed_actions: authorization.user_explicitly_authorized
        ? [
            'runtime_discovery_read',
            'authorized_business_context_read',
            'repo_local_verification_exec',
          ]
        : ['runtime_discovery_read'],
      required_artifacts: ['task_profile', 'route_resolution', 'runtime_gate'],
    };
  }

  if (
    taskProfile.explicit_mode
    && taskProfile.requested_capability === 'functional_audit_read_only'
  ) {
    return {
      route_id: 'explicit_read_only_functional_audit',
      phase: 'evidence_collection',
      allowed_actions: authorization.user_explicitly_authorized
        ? [
            'runtime_discovery_read',
            'authorized_business_context_read',
          ]
        : ['runtime_discovery_read'],
      required_artifacts: ['task_profile', 'route_resolution', 'runtime_gate'],
    };
  }

  return {
    route_id: 'declined_general_execution',
    phase: 'intake',
    allowed_actions: ['runtime_discovery_read'],
    required_artifacts: ['task_profile'],
  };
}

function buildRuntimeGate(input = {}) {
  const task_profile = normalizeTaskProfile(input);
  const authorization = extractAuthorization(input);
  const route_resolution = resolveRoute(task_profile, authorization);

  const allowedPaths = authorization.allowed_paths.length > 0
    ? authorization.allowed_paths
    : ['contracts/', 'scripts/', 'docs/', 'README.md', 'AGENTS.md'];

  if (route_resolution.route_id === 'declined_general_execution') {
    return {
      status: 'declined',
      task_profile,
      route_resolution,
      blocking_reasons: ['unsupported_task_profile_for_cutepower_route'],
      phase: 'intake',
      allowed_actions: route_resolution.allowed_actions,
      allowed_paths: [],
      evidence_collection_mode: null,
      capability: null,
      required_preflight_outputs: route_resolution.required_artifacts,
    };
  }

  if (route_resolution.route_id === 'explicit_hook_integration_fix') {
    if (!authorization.user_explicitly_authorized || !authorization.project_paths_authorized) {
      return {
        status: 'blocked',
        task_profile,
        route_resolution,
        blocking_reasons: ['explicit_authorization_for_project_read_missing'],
        phase: 'intake',
        allowed_actions: ['runtime_discovery_read'],
        allowed_paths: [],
        evidence_collection_mode: null,
        capability: 'hook_integration_fix',
        required_preflight_outputs: route_resolution.required_artifacts,
      };
    }

    return {
      status: 'ready',
      task_profile,
      route_resolution,
      phase: route_resolution.phase,
      allowed_actions: route_resolution.allowed_actions,
      allowed_paths: allowedPaths,
      evidence_collection_mode: 'implementation',
      capability: 'hook_integration_fix',
      authorization,
      required_preflight_outputs: route_resolution.required_artifacts,
    };
  }

  if (!authorization.user_explicitly_authorized || !authorization.project_paths_authorized) {
    return {
      status: 'blocked',
      task_profile,
      route_resolution,
      blocking_reasons: ['explicit_authorization_for_project_read_missing'],
      phase: 'intake',
      allowed_actions: ['runtime_discovery_read'],
      allowed_paths: [],
      evidence_collection_mode: null,
      capability: 'functional_audit_read_only',
      required_preflight_outputs: route_resolution.required_artifacts,
    };
  }

  if (authorization.evidence_collection_mode !== 'read_only') {
    return {
      status: 'blocked',
      task_profile,
      route_resolution,
      blocking_reasons: ['read_only_evidence_collection_mode_required'],
      phase: 'intake',
      allowed_actions: ['runtime_discovery_read'],
      allowed_paths: [],
      evidence_collection_mode: null,
      capability: 'functional_audit_read_only',
      required_preflight_outputs: route_resolution.required_artifacts,
    };
  }

  return {
    status: 'ready',
    task_profile,
    route_resolution,
    phase: route_resolution.phase,
    allowed_actions: route_resolution.allowed_actions,
    allowed_paths: allowedPaths,
    evidence_collection_mode: 'read_only',
    capability: 'functional_audit_read_only',
    authorization,
    required_preflight_outputs: route_resolution.required_artifacts,
  };
}

module.exports = {
  buildRuntimeGate,
  extractAuthorization,
  normalizeTaskProfile,
  resolveRoute,
};
