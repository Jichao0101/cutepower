'use strict';

function matchesAnyPattern(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

const EXPLICIT_CUTEPOWER_PATTERNS = Object.freeze([
  /\bcutepower\b/,
  /\bstrict cutepower\b/,
  /\bexplicit cutepower\b/,
  /\bexplicit mode\b/,
  /\bcute-[\w-]+\b/,
  /按\s*cutepower/,
  /按照\s*cutepower/,
  /严格按照\s*cutepower/,
  /用\s*cutepower/,
  /使用\s*cutepower/,
]);

const AUDIT_PATTERNS = Object.freeze([
  /read-?only functional audit/,
  /functional audit/,
  /readonly audit/,
  /read only audit/,
  /read-?only review/,
  /readonly review/,
  /\bcode review\b/,
  /\bfunctional review\b/,
  /按\s*cutepower.*(?:审查|分析|review|audit|检查)/,
  /按照\s*cutepower.*(?:审查|分析|review|audit|检查)/,
  /严格按照\s*cutepower.*(?:审查|分析|review|audit|检查)/,
  /只读审查/,
  /read-?only\s*审查/,
  /合规分析/,
  /符合性分析/,
  /对照设计文档(?:检查|审查|分析|review|audit)?/,
  /代码对照设计文档/,
  /是否满足设计文档/,
  /是否符合设计/,
  /design(?: document| doc)?.*(?:compliance|conformance|review|audit|check)/,
  /check.*design(?: document| doc)/,
]);

const READ_ONLY_PATTERNS = Object.freeze([
  /read-?only/,
  /readonly/,
  /read only/,
  /只读/,
  /不修改代码/,
  /只分析/,
  /仅分析/,
  /analysis only/,
  /analyze only/,
  /do not modify code/,
  /without modifying code/,
]);

const HOOK_INTEGRATION_FIX_PATTERNS = Object.freeze([
  /hook integration fix/,
  /codex hook integration fix/,
  /host runtime defect/,
  /runtime defect/,
  /hook 宿主/,
  /hook 集成/,
  /新版 codex hook 宿主/,
  /修复.*(?:codex hook|hook|宿主).*(?:兼容|集成|问题|异常|缺陷)/,
  /(?:codex hook|hook|宿主).*(?:修复|改造|兼容|集成问题)/,
]);

function extractPromptText(input = {}) {
  return String(
    input.prompt
    || input.user_prompt
    || input.text
    || (input.input && (input.input.prompt || input.input.user_prompt || input.input.text))
    || ''
  );
}

function analyzeCutepowerIntent(input = {}) {
  const prompt = extractPromptText(input).trim();
  const normalizedPrompt = prompt.toLowerCase();
  const repoGovernanceTerms = [
    ...AUDIT_PATTERNS,
    /\breview\b/,
    /\bwriteback\b/,
    /\bboard_execute\b/,
    /\bboard execute\b/,
    /protected business execution/,
    /\bincident\b/,
    /审查/,
    /审核/,
    /分析代码/,
    /设计文档/,
  ];
  const isExplicitCutepowerRequest = matchesAnyPattern(EXPLICIT_CUTEPOWER_PATTERNS, normalizedPrompt)
    || matchesAnyPattern(AUDIT_PATTERNS, normalizedPrompt);
  const isRepoGovernanceTask = matchesAnyPattern(repoGovernanceTerms, normalizedPrompt);
  const isGreetingLike = /^(?:hi|hello|hey|hallo|你好|您好|嗨|哈喽)\b[!\s]*$/i.test(prompt);
  const isGeneralRepoQuestion = /^(?:please\s+)?(?:explain|summarize|describe)\s+(?:this|the)\s+repo\b/i.test(prompt);

  return {
    prompt,
    normalized_prompt: normalizedPrompt,
    is_explicit_cutepower_request: isExplicitCutepowerRequest,
    is_repo_governance_task: isRepoGovernanceTask,
    is_greeting_like: isGreetingLike,
    is_general_repo_question: isGeneralRepoQuestion,
    should_consider_cutepower: isExplicitCutepowerRequest || isRepoGovernanceTask,
  };
}

function normalizeTaskProfile(input = {}) {
  const intent = analyzeCutepowerIntent(input);
  const prompt = intent.normalized_prompt;
  const explicitMode = input.explicit_mode !== false;
  const requestedIntegrationFix = matchesAnyPattern(HOOK_INTEGRATION_FIX_PATTERNS, prompt)
    || input.task_type === 'hook_integration_fix';
  const requestedAudit = matchesAnyPattern(AUDIT_PATTERNS, prompt)
    || input.audit_mode === 'functional_read_only';
  const readOnlyRequested = requestedAudit
    || matchesAnyPattern(READ_ONLY_PATTERNS, prompt)
    || input.evidence_collection_mode === 'read_only';

  return {
    primary_type: requestedIntegrationFix
      ? 'hook_integration_fix'
      : requestedAudit
        ? 'functional_audit'
        : 'general_task',
    task_modifiers: requestedIntegrationFix
        ? ['implementation', 'verification']
        : requestedAudit
          ? ['read_only', 'strict']
        : [],
    explicit_mode: explicitMode,
    requested_capability: requestedIntegrationFix
      ? 'hook_integration_fix'
      : requestedAudit && readOnlyRequested
        ? 'functional_audit_read_only'
        : 'unknown',
    requested_outputs: ['task_profile', 'route_resolution', 'runtime_gate'],
    governance_signal: intent.should_consider_cutepower,
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
  analyzeCutepowerIntent,
  buildRuntimeGate,
  extractAuthorization,
  extractPromptText,
  normalizeTaskProfile,
  resolveRoute,
};
