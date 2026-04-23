'use strict';

const fs = require('fs');
const path = require('path');

const { writeArtifact } = require('./run-artifacts');
const { buildGovernanceVerdict } = require('./hook-response');

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

const AUDIT_INTENT_PATTERNS = Object.freeze([
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
  /做只读审查/,
  /做合规分析/,
  /做符合性分析/,
  /只读审查/,
  /read-?only\s*审查/,
  /合规分析/,
  /符合性分析/,
  /符合设计/,
  /满足设计文档/,
  /检查代码是否符合设计/,
  /检查代码是否符合设计文档/,
  /检查代码是否满足设计文档/,
  /对照设计做(?:符合性分析|合规分析|审查|分析|检查)/,
  /对照设计文档(?:检查|审查|分析|review|audit)?/,
  /代码对照设计文档/,
  /是否满足设计文档/,
  /是否符合设计/,
  /design(?: document| doc)?.*(?:compliance|conformance|review|audit|check)/,
  /check.*design(?: document| doc)/,
]);

const DESIGN_REFERENCE_PATTERNS = Object.freeze([
  /设计文档/,
  /对照设计/,
  /对照设计文档/,
  /design(?: document| doc)/,
]);

const CODE_ANALYSIS_PATTERNS = Object.freeze([
  /分析代码/,
  /代码分析/,
  /检查代码/,
  /代码检查/,
  /审查代码/,
  /检查代码是否/,
  /analy(?:s|z)e code/,
  /check code/,
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

const HOOK_SURFACE_PATTERNS = Object.freeze([
  /\bcodex hook\b/,
  /\bhook integration\b/,
  /\bruntime hook\b/,
  /\bhook runtime\b/,
  /\bhost runtime\b/,
  /\bhook\b/,
]);

const HOOK_ISSUE_PATTERNS = Object.freeze([
  /hook integration fix/,
  /codex hook integration fix/,
  /host runtime defect/,
  /runtime defect/,
  /runtime hook defect/,
  /hook 宿主/,
  /hook 集成/,
  /新版 codex hook 宿主/,
  /\bintegration\b/,
  /\bcompat(?:ibility)?\b/,
  /\bdefect\b/,
  /\bbug\b/,
  /兼容/,
  /问题/,
  /异常/,
  /缺陷/,
]);

const REPAIR_INTENT_PATTERNS = Object.freeze([
  /修复/,
  /改造/,
  /fix/,
  /repair/,
  /resolve/,
]);

function hasAuditIntent(prompt) {
  return matchesAnyPattern(AUDIT_INTENT_PATTERNS, prompt)
    || (
      matchesAnyPattern(DESIGN_REFERENCE_PATTERNS, prompt)
      && matchesAnyPattern(CODE_ANALYSIS_PATTERNS, prompt)
    );
}

function hasReadOnlyIntent(prompt) {
  return matchesAnyPattern(READ_ONLY_PATTERNS, prompt);
}

function hasHookIntegrationFixIntent(prompt) {
  if (matchesAnyPattern([
    /hook integration fix/,
    /codex hook integration fix/,
    /runtime hook defect/,
    /host runtime defect/,
    /修复\s*hook\s*与\s*宿主兼容问题/,
  ], prompt)) {
    return true;
  }

  return matchesAnyPattern(HOOK_SURFACE_PATTERNS, prompt)
    && (
      matchesAnyPattern(HOOK_ISSUE_PATTERNS, prompt)
      || matchesAnyPattern(REPAIR_INTENT_PATTERNS, prompt)
    );
}

const AUDIT_PATTERNS = Object.freeze([
  ...AUDIT_INTENT_PATTERNS,
  ...DESIGN_REFERENCE_PATTERNS,
  ...CODE_ANALYSIS_PATTERNS,
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
    ...AUDIT_INTENT_PATTERNS,
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
  const auditIntent = hasAuditIntent(normalizedPrompt);
  const readOnlyIntent = hasReadOnlyIntent(normalizedPrompt);
  const hookIntegrationFixIntent = hasHookIntegrationFixIntent(normalizedPrompt);
  const isExplicitCutepowerRequest = matchesAnyPattern(EXPLICIT_CUTEPOWER_PATTERNS, normalizedPrompt);
  const isRepoGovernanceTask = matchesAnyPattern(repoGovernanceTerms, normalizedPrompt)
    || auditIntent
    || hookIntegrationFixIntent
    || (matchesAnyPattern(DESIGN_REFERENCE_PATTERNS, normalizedPrompt) && readOnlyIntent);
  const isGreetingLike = /^(?:hi|hello|hey|hallo|你好|您好|嗨|哈喽)\b[!\s]*$/i.test(prompt);
  const isGeneralRepoQuestion = /^(?:please\s+)?(?:explain|summarize|describe)\s+(?:this|the)\s+repo\b/i.test(prompt);

  return {
    prompt,
    normalized_prompt: normalizedPrompt,
    is_explicit_cutepower_request: isExplicitCutepowerRequest,
    is_repo_governance_task: isRepoGovernanceTask,
    is_audit_intent: auditIntent,
    is_read_only_intent: readOnlyIntent,
    is_hook_integration_fix_intent: hookIntegrationFixIntent,
    is_greeting_like: isGreetingLike,
    is_general_repo_question: isGeneralRepoQuestion,
    should_consider_cutepower: isExplicitCutepowerRequest || isRepoGovernanceTask,
  };
}

function normalizeTaskProfile(input = {}) {
  const intent = analyzeCutepowerIntent(input);
  const prompt = intent.normalized_prompt;
  const explicitMode = input.explicit_mode !== false;
  const requestedIntegrationFix = intent.is_hook_integration_fix_intent
    || input.task_type === 'hook_integration_fix';
  const requestedAudit = intent.is_audit_intent
    || input.audit_mode === 'functional_read_only';
  const readOnlyRequested = requestedAudit
    || intent.is_read_only_intent
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
    session_id: input.session_id || input.sessionId || null,
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

function ensureSessionId(input = {}) {
  return input.session_id
    || input.sessionId
    || `cutepower-${Date.now()}-${process.pid}`;
}

function resolveWorkspaceRoot(input = {}) {
  const candidate = input.cwd
    || input.working_directory
    || input.workspace_root
    || input.repo_root
    || input.project_root
    || (input.input && (
      input.input.cwd
      || input.input.working_directory
      || input.input.workspace_root
      || input.input.repo_root
    ))
    || process.cwd();

  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new TypeError('workspace_root_must_be_a_non_empty_string');
  }
  return path.resolve(candidate);
}

function persistPreflightArtifacts(input = {}, runtimeGate) {
  const sessionId = ensureSessionId(input);
  const workspaceRoot = resolveWorkspaceRoot(input);
  const artifactRoot = path.join(workspaceRoot, '.cutepower');
  const taskProfilePath = writeArtifact(artifactRoot, sessionId, 'task_profile', runtimeGate.task_profile);
  const routeResolutionPath = writeArtifact(artifactRoot, sessionId, 'route_resolution', runtimeGate.route_resolution);
  const runtimeGatePath = writeArtifact(
    artifactRoot,
    sessionId,
    'runtime_gate',
    {
      ...runtimeGate,
      session_id: sessionId,
      artifact_dir: path.join(artifactRoot, 'run', sessionId),
    }
  );
  return {
    session_id: sessionId,
    workspace_root: workspaceRoot,
    artifact_dir: path.join(artifactRoot, 'run', sessionId),
    persisted_artifacts: {
      task_profile: fs.existsSync(taskProfilePath),
      route_resolution: fs.existsSync(routeResolutionPath),
      runtime_gate: fs.existsSync(runtimeGatePath),
    },
  };
}

function evaluateIntake(input = {}) {
  const sessionId = ensureSessionId(input);
  const runtimeGate = buildRuntimeGate({
    ...input,
    session_id: sessionId,
  });
  const persisted = persistPreflightArtifacts(
    {
      ...input,
      session_id: sessionId,
    },
    runtimeGate
  );
  const requiredArtifacts = runtimeGate.required_preflight_outputs || [
    'task_profile',
    'route_resolution',
    'runtime_gate',
  ];
  const missingArtifacts = requiredArtifacts.filter((name) => !persisted.persisted_artifacts[name]);
  const gateResult = runtimeGate.status === 'ready'
    ? (missingArtifacts.length === 0 ? 'ready' : 'blocked')
    : runtimeGate.status === 'declined'
      ? 'declined'
      : 'blocked';
  const allowedToContinue = gateResult === 'ready';
  return buildGovernanceVerdict('user_prompt_submit', {
    gate_result: gateResult,
    allowed_to_continue: allowedToContinue,
    reason: gateResult === 'ready'
      ? 'cutepower_takeover_ready'
      : gateResult === 'declined'
        ? 'cutepower_takeover_requested_but_no_supported_route'
        : missingArtifacts.length > 0
          ? 'required_preflight_artifacts_missing'
          : 'cutepower_takeover_blocked_by_runtime_gate',
    required_artifacts: requiredArtifacts,
    missing_artifacts: missingArtifacts,
    allowed_actions: runtimeGate.allowed_actions || [],
    session: {
      session_id: sessionId,
      route_id: runtimeGate.route_resolution ? runtimeGate.route_resolution.route_id : null,
      phase: runtimeGate.phase || null,
      capability: runtimeGate.capability || null,
    },
    runtime_gate: {
      ...runtimeGate,
      session_id: sessionId,
      artifact_dir: persisted.artifact_dir,
    },
    diagnostics: {
      task_profile: runtimeGate.task_profile,
      route_resolution: runtimeGate.route_resolution,
      runtime_gate_status: runtimeGate.status,
      blocking_reasons: runtimeGate.blocking_reasons || [],
      artifact_dir: persisted.artifact_dir,
      persisted_artifacts: persisted.persisted_artifacts,
    },
    entry_action: allowedToContinue ? 'take_over_for_cutepower' : 'legal_block',
    message: allowedToContinue
      ? 'cutepower takeover is ready.'
      : 'cutepower takeover is blocked before downstream execution.',
  });
}

module.exports = {
  analyzeCutepowerIntent,
  buildRuntimeGate,
  ensureSessionId,
  evaluateIntake,
  extractAuthorization,
  extractPromptText,
  normalizeTaskProfile,
  persistPreflightArtifacts,
  resolveRoute,
  resolveWorkspaceRoot,
};
