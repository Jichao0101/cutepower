'use strict';

const fs = require('fs');
const path = require('path');

const { writeArtifact } = require('./run-artifacts');
const { buildGovernanceVerdict } = require('./governance-response');
const { buildTaskProfile, loadContracts } = require('./task-profile');

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
  const isExplicitCutepowerRequest = matchesAnyPattern(EXPLICIT_CUTEPOWER_PATTERNS, normalizedPrompt);
  const isRepoGovernanceTask = matchesAnyPattern(repoGovernanceTerms, normalizedPrompt)
    || auditIntent
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
    is_greeting_like: isGreetingLike,
    is_general_repo_question: isGeneralRepoQuestion,
    should_consider_cutepower: isExplicitCutepowerRequest || isRepoGovernanceTask,
  };
}

function normalizeTaskProfile(input = {}, docs = loadContracts()) {
  const intent = analyzeCutepowerIntent(input);
  const taskGoal = extractPromptText(input).trim();
  if (!taskGoal) {
    return {
      primary_type: null,
      route_id: null,
      route_status: 'needs_clarification',
      requires_dispatch: false,
      governance_signal: intent.should_consider_cutepower,
      resolved_skill_chain: [],
      missing_context: [],
      inferred_context: {},
    };
  }

  const profiled = buildTaskProfile({
    task_goal: taskGoal,
    cwd: input.cwd || input.workspace_root || input.repo_root || process.cwd(),
    board_target: input.board_target,
  }, docs);

  return {
    ...profiled,
    primary_type: intent.is_audit_intent ? 'audit' : profiled.primary_type,
    route_id: intent.is_audit_intent && (intent.is_read_only_intent || input.evidence_collection_mode === 'read_only')
      ? 'audit_functional_read_only'
      : profiled.route_id,
    route_status: intent.is_audit_intent && (intent.is_read_only_intent || input.evidence_collection_mode === 'read_only')
      ? 'resolved'
      : profiled.route_status,
    task_modifiers: intent.is_audit_intent
      ? Array.from(new Set([...(profiled.task_modifiers || []), 'functional_scope', 'read_only'])).sort()
      : profiled.task_modifiers,
    resolved_skill_chain: intent.is_audit_intent && (intent.is_read_only_intent || input.evidence_collection_mode === 'read_only')
      ? ['cute-scope-plan', 'cute-functional-review', 'cute-writeback']
      : profiled.resolved_skill_chain,
    requires_dispatch: intent.is_audit_intent ? true : profiled.requires_dispatch,
    explicit_mode: input.explicit_mode !== false,
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

function resolveRoute(taskProfile, authorization, docs = loadContracts()) {
  const runtimeEntry = docs['task-normalization'].activation.runtime_entry;
  if (!taskProfile || !taskProfile.route_id) {
    return {
      route_id: 'declined_general_execution',
      phase: 'intake',
      allowed_actions: ['runtime_discovery_read'],
      required_artifacts: ['task_profile'],
      skill_chain: [],
      dispatcher_skill: runtimeEntry.mandatory_dispatcher_skill,
    };
  }

  const route = docs['routing-table'].routes.find((entry) => entry.route_id === taskProfile.route_id);
  const skillRoute = docs['skill-route-matrix'].routes.find((entry) => entry.route_id === taskProfile.route_id);
  const isReadOnlyAudit = taskProfile.primary_type === 'audit' && taskProfile.task_modifiers.includes('read_only');
  const phase = skillRoute && skillRoute.ordered_skills.length > 0
    ? skillRoute.ordered_skills[0].phase
    : (route.required_gates[0] || 'analysis');

  const allowedActions = isReadOnlyAudit
    ? (
      authorization.user_explicitly_authorized
        ? ['runtime_discovery_read', 'authorized_business_context_read']
        : ['runtime_discovery_read']
    )
    : route.required_gates.includes('implementation')
      ? ['runtime_discovery_read', 'authorized_business_context_read', 'repo_local_verification_exec']
      : ['runtime_discovery_read', 'authorized_business_context_read'];

  return {
    route_id: route.route_id,
    phase,
    allowed_actions: allowedActions,
    required_artifacts: ['task_profile', 'route_resolution', 'runtime_gate', runtimeEntry.dispatch_output],
    skill_chain: route.skill_chain,
    dispatcher_skill: skillRoute ? skillRoute.dispatcher_skill : runtimeEntry.mandatory_dispatcher_skill,
    writeback_level: route.writeback_level,
  };
}

function buildDispatchManifest({ sessionId, taskProfile, routeResolution, docs = loadContracts() }) {
  const skillRoute = docs['skill-route-matrix'].routes.find((entry) => entry.route_id === routeResolution.route_id);
  if (!skillRoute || skillRoute.ordered_skills.length === 0) {
    return null;
  }
  const firstSkill = skillRoute.ordered_skills[0];
  return {
    session_id: sessionId,
    route_id: routeResolution.route_id,
    dispatcher_skill: skillRoute.dispatcher_skill,
    current_phase: routeResolution.phase,
    current_skill: skillRoute.dispatcher_skill,
    next_skill: firstSkill.skill_id,
    allowed_following_skills: skillRoute.ordered_skills.map((skill) => skill.skill_id),
    required_artifacts_for_next_skill: firstSkill.required_artifacts_in,
    completed_skills: [],
    route_skill_chain: taskProfile.resolved_skill_chain || skillRoute.ordered_skills.map((skill) => skill.skill_id),
    direct_entry_forbidden: true,
  };
}

function buildRuntimeGate(input = {}) {
  const docs = loadContracts();
  const task_profile = normalizeTaskProfile(input, docs);
  const authorization = extractAuthorization(input);
  const route_resolution = resolveRoute(task_profile, authorization, docs);
  const dispatch_manifest = buildDispatchManifest({
    sessionId: input.session_id || input.sessionId || null,
    taskProfile: task_profile,
    routeResolution: route_resolution,
    docs,
  });

  const allowedPaths = authorization.allowed_paths.length > 0
    ? authorization.allowed_paths
    : ['contracts/', 'scripts/', 'docs/', 'README.md', 'AGENTS.md'];

  if (route_resolution.route_id === 'declined_general_execution') {
    return {
      status: 'declined',
      task_profile,
      route_resolution,
      dispatch_manifest,
      blocking_reasons: ['unsupported_task_profile_for_cutepower_route'],
      phase: 'intake',
      allowed_actions: route_resolution.allowed_actions,
      allowed_paths: [],
      evidence_collection_mode: null,
      capability: null,
      required_preflight_outputs: route_resolution.required_artifacts,
    };
  }

  if (!authorization.user_explicitly_authorized || !authorization.project_paths_authorized) {
    return {
      status: 'blocked',
      task_profile,
      route_resolution,
      dispatch_manifest,
      blocking_reasons: ['explicit_authorization_for_project_read_missing'],
      phase: 'intake',
      allowed_actions: ['runtime_discovery_read'],
      allowed_paths: [],
      evidence_collection_mode: null,
      capability: null,
      required_preflight_outputs: route_resolution.required_artifacts,
    };
  }

  const readOnlyRoute = task_profile.primary_type === 'audit' && task_profile.task_modifiers.includes('read_only');
  if (readOnlyRoute && authorization.evidence_collection_mode !== 'read_only') {
    return {
      status: 'blocked',
      task_profile,
      route_resolution,
      dispatch_manifest,
      blocking_reasons: ['read_only_evidence_collection_mode_required'],
      phase: 'intake',
      allowed_actions: ['runtime_discovery_read'],
      allowed_paths: [],
      evidence_collection_mode: null,
      capability: null,
      required_preflight_outputs: route_resolution.required_artifacts,
    };
  }

  return {
    session_id: input.session_id || input.sessionId || null,
    status: 'ready',
    task_profile,
    route_resolution,
    dispatch_manifest,
    phase: route_resolution.phase,
    allowed_actions: route_resolution.allowed_actions,
    allowed_paths: allowedPaths,
    evidence_collection_mode: readOnlyRoute ? 'read_only' : 'implementation',
    capability: readOnlyRoute ? 'functional_audit_read_only' : 'governed_route_execution',
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
  const dispatchManifestPath = writeArtifact(artifactRoot, sessionId, 'dispatch_manifest', runtimeGate.dispatch_manifest || {});
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
      dispatch_manifest: fs.existsSync(dispatchManifestPath),
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
    'dispatch_manifest',
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
      dispatch_manifest: runtimeGate.dispatch_manifest,
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
  buildDispatchManifest,
};
