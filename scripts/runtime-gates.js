'use strict';

const fs = require('fs');
const path = require('path');

const { artifactPath } = require('./run-artifacts');
const { buildGovernanceVerdict } = require('./governance-response');
const { validateSessionCapability } = require('./host-runtime');
const {
  FUNCTIONAL_REVIEW_REQUIRED_ARTIFACTS,
  isFunctionalReviewSession,
  validateFunctionalReviewArtifacts,
} = require('./review-artifacts');

const DEFAULT_REQUIRED_PREFLIGHT = Object.freeze([
  'task_profile',
  'route_resolution',
  'dispatch_manifest',
  'runtime_gate',
]);

function includesAction(hostRuntime, action) {
  return Array.isArray(hostRuntime.allowed_actions)
    && hostRuntime.allowed_actions.includes(action);
}

function pathAllowed(hostRuntime, command, targetPaths = []) {
  const allowedPaths = hostRuntime.allowed_paths || [];
  if (allowedPaths.some((allowedPath) => command.includes(allowedPath))) {
    return true;
  }
  return targetPaths.some((targetPath) => allowedPaths.some((allowedPath) => String(targetPath).includes(allowedPath)));
}

function gateToolAction({ action, hostRuntime, command, targetPaths = [] }) {
  if (action === 'runtime_discovery_read') {
    return {
      gate_result: 'ready',
      reason: 'runtime_discovery_read_allowed',
    };
  }

  if (action === 'repo_local_verification_exec') {
    if (!/node\s+scripts\/test-[\w-]+\.js(?:\s|$)/.test(command)) {
      return {
        gate_result: 'blocked',
        reason: 'repo_local_verification_exec_only_allows_repo_test_scripts',
      };
    }
    if (
      Array.isArray(hostRuntime.allowed_actions)
      && hostRuntime.allowed_actions.length > 0
      && !includesAction(hostRuntime, action)
    ) {
      return {
        gate_result: 'blocked',
        reason: 'route_missing_repo_local_verification_exec',
      };
    }
    if (
      hostRuntime.phase
      && hostRuntime.phase !== 'implementation'
      && hostRuntime.phase !== 'verification'
    ) {
      return {
        gate_result: 'blocked',
        reason: 'repo_local_verification_exec_outside_implementation_phase',
      };
    }
    return {
      gate_result: 'ready',
      reason: 'repo_local_verification_exec_allowed',
    };
  }

  if (action === 'authorized_business_context_read') {
    if (!includesAction(hostRuntime, action)) {
      return {
        gate_result: 'blocked',
        reason: 'route_missing_authorized_business_context_read',
      };
    }
    if (!['analysis', 'implementation', 'review'].includes(hostRuntime.phase)) {
      return {
        gate_result: 'blocked',
        reason: 'authorized_business_context_read_outside_read_or_implementation_phase',
      };
    }
    if (!['read_only', 'implementation'].includes(hostRuntime.evidence_collection_mode)) {
      return {
        gate_result: 'blocked',
        reason: 'authorized_business_context_read_requires_read_only_evidence_collection_mode',
      };
    }
    if (!pathAllowed(hostRuntime, command, targetPaths)) {
      return {
        gate_result: 'blocked',
        reason: 'authorized_business_context_read_outside_allowed_paths',
      };
    }
    return {
      gate_result: 'ready',
      reason: 'authorized_business_context_read_allowed_for_route',
    };
  }

  return {
    gate_result: 'blocked',
    reason: 'tool_action_denied_by_runtime_gate',
  };
}

function artifactStatus(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value.status || value.decision || null;
}

function buildBlockedTerminalArtifacts({ sessionId, routeId, blockedReason }) {
  return {
    requirements_package: {
      requirements: [
        {
          requirement_id: 'BLOCKED-REVIEW',
          requirement_text: 'Review may close only as blocked.',
          requirement_type: 'functional',
          severity: 'high',
          source_path: 'runtime',
        },
      ],
    },
    acceptance_items: {
      acceptance_items: [
        {
          acceptance_item_id: 'BLOCKED-ACC-1',
          mapped_requirement_ids: ['BLOCKED-REVIEW'],
          pass_criteria: 'Blocked state is explicitly recorded.',
          expected_evidence_types: ['blocked_terminal_record'],
        },
      ],
    },
    evidence_plan: {
      allowed_paths: ['runtime'],
      planned_evidence_sources: ['runtime'],
    },
    relevant_context: {
      allowed_paths: ['runtime'],
      core_paths: ['runtime'],
    },
    evidence_manifest: {
      session_id: sessionId,
      route_id: routeId,
      status: 'blocked',
      reason: blockedReason,
      evidence: [],
    },
    review_decision: {
      session_id: sessionId,
      route_id: routeId,
      decision: 'blocked',
      blocked_by: [blockedReason],
      allows_completed: false,
      reason: blockedReason,
    },
    evidence_gaps: {
      gaps: [
        {
          requirement_id: 'BLOCKED-REVIEW',
          acceptance_item_id: 'BLOCKED-ACC-1',
          reason: 'acceptance_item_missing_evidence_coverage',
          blocker: true,
        },
      ],
    },
    compliance_matrix: {
      rows: [
        {
          requirement_id: 'BLOCKED-REVIEW',
          acceptance_item_ids: ['BLOCKED-ACC-1'],
          evidence_ids: [],
          status: 'gap',
          notes: blockedReason,
        },
      ],
    },
    writeback_declined: {
      session_id: sessionId,
      route_id: routeId,
      status: 'declined',
      reason: 'blocked_review_cannot_writeback',
    },
    terminal_phase: 'blocked_closed',
  };
}

function getCommand(payload = {}) {
  if (typeof payload.cmd === 'string') {
    return payload.cmd;
  }
  if (typeof payload.command === 'string') {
    return payload.command;
  }
  if (Array.isArray(payload.command)) {
    return payload.command.join(' ');
  }
  if (payload.tool_input && typeof payload.tool_input.cmd === 'string') {
    return payload.tool_input.cmd;
  }
  if (payload.tool_input && typeof payload.tool_input.command === 'string') {
    return payload.tool_input.command;
  }
  if (payload.input && typeof payload.input.cmd === 'string') {
    return payload.input.cmd;
  }
  if (payload.input && typeof payload.input.command === 'string') {
    return payload.input.command;
  }
  if (typeof payload.tool_input === 'string') {
    return payload.tool_input;
  }
  return '';
}

function lowerCaseSet(values) {
  return new Set((values || []).map((item) => String(item).toLowerCase()));
}

function inferToolAction(payload, hostRuntime) {
  const metadataInference = inferToolActionFromMetadata(payload, hostRuntime);
  if (metadataInference) {
    return metadataInference;
  }
  return inferToolActionFromCommand(payload, hostRuntime);
}

function extractToolMetadata(payload = {}) {
  const metadata = payload.tool_metadata || payload.metadata || payload.tool || payload.event_metadata || {};
  const toolInput = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const input = payload.input && typeof payload.input === 'object' ? payload.input : {};
  const sources = [payload, metadata, toolInput, input];
  const first = (...keys) => {
    for (const source of sources) {
      if (!source || typeof source !== 'object') {
        continue;
      }
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
          return source[key];
        }
      }
    }
    return null;
  };

  const targetPaths = [];
  for (const value of [
    first('target_paths', 'paths'),
    first('target_path', 'path', 'file'),
  ]) {
    if (Array.isArray(value)) {
      targetPaths.push(...value.map((item) => String(item)));
    } else if (typeof value === 'string') {
      targetPaths.push(value);
    }
  }

  const structured = {
    tool_name: first('tool_name', 'tool', 'name', 'event_name', 'hook_event'),
    operation_class: first('operation_class', 'op_class', 'operation'),
    intent: first('intent', 'read_write_intent', 'access_intent'),
    command_type: first('command_type', 'tool_kind'),
    is_mutating: first('is_mutating'),
    is_external_exec: first('is_external_exec'),
    is_network_like: first('is_network_like'),
    privilege_level: first('privilege_level'),
    target_paths: targetPaths,
    command: getCommand(payload).trim(),
  };

  const hasMetadata = Object.values(structured).some((value) => {
    return false;
  });
  const hasStructuredMetadata = [
    structured.tool_name,
    structured.operation_class,
    structured.intent,
    structured.command_type,
    structured.is_mutating,
    structured.is_external_exec,
    structured.is_network_like,
    structured.privilege_level,
  ].some((value) => value != null && value !== '')
    || structured.target_paths.length > 0;

  return hasStructuredMetadata ? structured : null;
}

function inferToolActionFromMetadata(payload, hostRuntime) {
  const metadata = extractToolMetadata(payload);
  if (!metadata) {
    return null;
  }

  const allowedActions = new Set((hostRuntime.allowed_actions || []).map((item) => String(item)));
  const allowedPaths = (hostRuntime.allowed_paths || []).map((item) => String(item));
  const readOnlyTools = lowerCaseSet(['read', 'open', 'view', 'grep', 'glob', 'search', 'list']);
  const toolName = String(metadata.tool_name || '').toLowerCase();
  const operationClass = String(metadata.operation_class || '').toLowerCase();
  const intent = String(metadata.intent || '').toLowerCase();
  const commandType = String(metadata.command_type || '').toLowerCase();
  const normalizedTargets = metadata.target_paths.map((item) => String(item));
  const touchesAllowedPaths = normalizedTargets.length === 0
    ? false
    : normalizedTargets.some((targetPath) => allowedPaths.some((allowedPath) => targetPath.includes(allowedPath)));
  const touchesBusinessContext = normalizedTargets.some((targetPath) => /contracts\/|README|AGENTS|docs\/|scripts\//.test(targetPath));

  if (metadata.is_network_like === true) {
    return {
      action: 'unmapped_tool_event',
      reason: 'metadata_network_like_operation_denied',
      command: metadata.command,
      risk_level: 'high',
      inference_source: 'metadata',
      inference_basis: {
        is_network_like: true,
      },
      uncertainty: 'low',
    };
  }

  if (
    metadata.is_mutating === true
    || ['write', 'edit', 'delete', 'patch', 'mutate'].includes(intent)
    || ['write', 'edit', 'delete', 'patch'].includes(operationClass)
    || ['applypatch', 'edit', 'write'].includes(toolName)
  ) {
    return {
      action: 'unmapped_tool_event',
      reason: 'metadata_mutating_operation_denied',
      command: metadata.command,
      risk_level: 'high',
      inference_source: 'metadata',
      inference_basis: {
        tool_name: metadata.tool_name,
        operation_class: metadata.operation_class,
        intent: metadata.intent,
        is_mutating: metadata.is_mutating,
      },
      uncertainty: 'low',
    };
  }

  if (metadata.is_external_exec === true || operationClass === 'exec' || commandType === 'exec') {
    const command = metadata.command;
    const isRepoLocalRegressionTest = /^node\s+scripts\/test-[\w-]+\.js(?:\s|$)/.test(command);
    return {
      action: isRepoLocalRegressionTest ? 'repo_local_verification_exec' : 'unmapped_tool_event',
      reason: isRepoLocalRegressionTest
        ? 'metadata_external_exec_matches_repo_local_verification'
        : 'metadata_external_exec_denied',
      command,
      target_paths: normalizedTargets,
      risk_level: 'high',
      inference_source: 'metadata',
      inference_basis: {
        is_external_exec: metadata.is_external_exec,
        command_type: metadata.command_type,
        operation_class: metadata.operation_class,
      },
      uncertainty: command ? 'low' : 'medium',
    };
  }

  if (
    intent === 'read'
    || operationClass === 'read'
    || readOnlyTools.has(toolName)
  ) {
    if (!touchesBusinessContext) {
      return {
        action: 'runtime_discovery_read',
        reason: 'metadata_read_only_runtime_discovery',
        command: metadata.command,
        target_paths: normalizedTargets,
        risk_level: 'low',
        inference_source: 'metadata',
        inference_basis: {
          tool_name: metadata.tool_name,
          target_paths: metadata.target_paths,
        },
        uncertainty: normalizedTargets.length === 0 ? 'medium' : 'low',
      };
    }
    if (
      hostRuntime.evidence_collection_mode === 'read_only'
      && touchesAllowedPaths
      && allowedActions.has('authorized_business_context_read')
    ) {
      return {
        action: 'authorized_business_context_read',
        reason: 'metadata_business_context_read_authorized',
        command: metadata.command,
        target_paths: normalizedTargets,
        risk_level: 'low',
        inference_source: 'metadata',
        inference_basis: {
          target_paths: metadata.target_paths,
          allowed_paths: allowedPaths,
        },
        uncertainty: 'low',
      };
    }
    return {
      action: 'forbidden_business_context_read',
      reason: 'metadata_business_context_read_outside_allowed_paths',
      command: metadata.command,
      target_paths: normalizedTargets,
      risk_level: 'low',
      inference_source: 'metadata',
      inference_basis: {
        target_paths: metadata.target_paths,
        allowed_paths: allowedPaths,
      },
      uncertainty: 'low',
    };
  }

  return {
    action: 'unmapped_tool_event',
    reason: 'metadata_present_but_unclassified',
    command: metadata.command,
    target_paths: normalizedTargets,
    risk_level: 'high',
    inference_source: 'metadata',
    inference_basis: metadata,
    uncertainty: 'medium',
  };
}

function inferToolActionFromCommand(payload, hostRuntime) {
  const command = getCommand(payload).trim();
  if (!command) {
    return {
      action: 'runtime_discovery_read',
      reason: 'empty_command_treated_as_runtime_discovery',
      command,
      target_paths: [],
      risk_level: 'low',
      inference_source: 'command_fallback',
      inference_basis: { command: '' },
      uncertainty: 'low',
    };
  }

  const tokens = command.split(/\s+/);
  const verb = tokens[0].toLowerCase();
  const readOnlyVerbs = lowerCaseSet([
    'cat',
    'sed',
    'rg',
    'grep',
    'find',
    'ls',
    'pwd',
    'git',
    'head',
    'tail',
    'wc',
    'sort',
    'uniq',
  ]);
  const mutatingVerbs = lowerCaseSet([
    'rm',
    'mv',
    'cp',
    'touch',
    'tee',
    'mkdir',
    'node',
    'npm',
    'pnpm',
    'yarn',
    'python',
    'python3',
    'bash',
    'sh',
  ]);
  const allowedPaths = (hostRuntime.allowed_paths || []).map((item) => String(item));
  const allowedActions = new Set((hostRuntime.allowed_actions || []).map((item) => String(item)));
  const evidenceReadOnly = hostRuntime.evidence_collection_mode === 'read_only';
  const commandTargetsAllowedPath = allowedPaths.some((prefix) => command.includes(prefix));
  const commandTargetsRepoEvidence = /contracts\/|README|AGENTS|docs\/|scripts\//.test(command);
  const isRepoLocalRegressionTest = /^node\s+scripts\/test-[\w-]+\.js(?:\s|$)/.test(command);

  if (verb === 'pwd') {
    return {
      action: 'runtime_discovery_read',
      reason: 'pwd_is_runtime_discovery',
      command,
      target_paths: [],
      risk_level: 'low',
      inference_source: 'command_fallback',
      inference_basis: { verb },
      uncertainty: 'low',
    };
  }

  if (verb === 'git') {
    if (/git\s+(show|diff|status|log)\b/.test(command)) {
      return {
        action: commandTargetsAllowedPath || !commandTargetsRepoEvidence
          ? 'authorized_business_context_read'
          : 'forbidden_business_context_read',
        reason: commandTargetsAllowedPath
          ? 'git_read_within_allowed_paths'
          : 'git_read_targets_business_context_without_authorization',
        command,
        target_paths: [],
        risk_level: 'low',
        inference_source: 'command_fallback',
        inference_basis: { verb, commandTargetsAllowedPath },
        uncertainty: 'medium',
      };
    }
    return {
      action: 'unmapped_tool_event',
      reason: 'git_mutation_or_unknown_git_command',
      command,
      target_paths: [],
      risk_level: 'high',
      inference_source: 'command_fallback',
      inference_basis: { verb },
      uncertainty: 'medium',
    };
  }

  if (readOnlyVerbs.has(verb)) {
    if (!commandTargetsRepoEvidence) {
      return {
        action: 'runtime_discovery_read',
        reason: 'read_only_command_without_business_context_target',
        command,
        target_paths: [],
        risk_level: 'low',
        inference_source: 'command_fallback',
        inference_basis: { verb },
        uncertainty: 'medium',
      };
    }
    if (
      evidenceReadOnly
      && commandTargetsAllowedPath
      && allowedActions.has('authorized_business_context_read')
    ) {
      return {
        action: 'authorized_business_context_read',
      reason: 'read_only_audit_evidence_collection_authorized',
        command,
        target_paths: [],
        risk_level: 'low',
        inference_source: 'command_fallback',
        inference_basis: { verb, commandTargetsAllowedPath },
        uncertainty: 'medium',
      };
    }
    return {
      action: 'forbidden_business_context_read',
      reason: 'business_context_read_missing_explicit_authorization_or_route',
      command,
      target_paths: [],
      risk_level: 'low',
      inference_source: 'command_fallback',
      inference_basis: { verb, commandTargetsAllowedPath },
      uncertainty: 'medium',
    };
  }

  if (verb === 'node' && isRepoLocalRegressionTest) {
    return {
      action: 'repo_local_verification_exec',
      reason: 'repo_local_regression_test_allowed_for_verification',
      command,
      target_paths: [],
      risk_level: 'high',
      inference_source: 'command_fallback',
      inference_basis: { verb, isRepoLocalRegressionTest },
      uncertainty: 'low',
    };
  }

  if (mutatingVerbs.has(verb)) {
    return {
      action: 'unmapped_tool_event',
      reason: 'mutating_or_unreviewed_command_denied_in_runtime_gate',
      command,
      target_paths: [],
      risk_level: 'high',
      inference_source: 'command_fallback',
      inference_basis: { verb },
      uncertainty: 'medium',
    };
  }

  return {
    action: 'unmapped_tool_event',
    reason: 'unmapped_tool_event',
    command,
    target_paths: [],
    risk_level: 'high',
    inference_source: 'command_fallback',
    inference_basis: { verb },
    uncertainty: 'high',
  };
}

function readArtifactIfPresent(hostRuntime, artifactName) {
  const artifactRoot = hostRuntime.artifact_root || (
    hostRuntime.workspace_root
      ? path.join(hostRuntime.workspace_root, '.cutepower')
      : null
  );
  if (!artifactRoot || !hostRuntime.session_id) {
    return null;
  }
  const target = artifactPath(artifactRoot, hostRuntime.session_id, artifactName);
  if (!fs.existsSync(target)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function extractGovernedSkill(payload = {}) {
  const metadata = payload.tool_metadata || payload.metadata || payload.tool || {};
  const candidates = [
    payload.skill_name,
    payload.skill,
    payload.current_skill,
    metadata.skill_name,
    metadata.skill,
    metadata.current_skill,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  return null;
}

function evaluateSkillTransition(hostRuntime, dispatchManifest, payload = {}) {
  const governedSkill = extractGovernedSkill(payload);
  if (!governedSkill) {
    return null;
  }
  if (!dispatchManifest || typeof dispatchManifest !== 'object') {
    return {
      gate_result: 'blocked',
      reason: 'dispatch_manifest_missing_for_skill_routing',
      governed_skill: governedSkill,
    };
  }
  if (dispatchManifest.next_skill !== governedSkill) {
    return {
      gate_result: 'blocked',
      reason: 'governed_skill_out_of_route_order',
      governed_skill: governedSkill,
      expected_next_skill: dispatchManifest.next_skill || null,
    };
  }
  if (dispatchManifest.current_phase && hostRuntime.phase && dispatchManifest.current_phase !== hostRuntime.phase) {
    return {
      gate_result: 'blocked',
      reason: 'dispatch_manifest_phase_mismatch',
      governed_skill: governedSkill,
      expected_phase: dispatchManifest.current_phase,
    };
  }
  return {
    gate_result: 'ready',
    reason: 'governed_skill_matches_dispatch_manifest',
    governed_skill: governedSkill,
  };
}

function collectArtifactState({ hostRuntime, artifacts = {}, requiredArtifacts = [] }) {
  const resolved = {};
  const missing = [];
  for (const artifactName of requiredArtifacts) {
    if (artifactName === 'writeback_receipt_or_writeback_declined') {
      const receipt = artifacts.writeback_receipt || readArtifactIfPresent(hostRuntime, 'writeback_receipt');
      const declined = artifacts.writeback_declined || readArtifactIfPresent(hostRuntime, 'writeback_declined');
      if (!receipt && !declined) {
        missing.push(artifactName);
      }
      resolved.writeback_receipt = receipt;
      resolved.writeback_declined = declined;
      continue;
    }
    const value = Object.prototype.hasOwnProperty.call(artifacts, artifactName)
      ? artifacts[artifactName]
      : readArtifactIfPresent(hostRuntime, artifactName);
    if (value == null) {
      missing.push(artifactName);
    }
    resolved[artifactName] = value || null;
  }
  return {
    artifacts: resolved,
    missing_artifacts: missing,
  };
}

function buildManagedSessionVerdict(hostRuntime) {
  return hostRuntime && hostRuntime.managed_by_cutepower
    ? null
    : buildGovernanceVerdict('pre_tool_use', {
        gate_result: 'not_applicable',
        allowed_to_continue: true,
        reason: 'cutepower_governance_not_active_for_session',
        host_status: 'not_applicable',
        session: {
          session_id: hostRuntime.session_id,
          route_id: hostRuntime.route_id,
          phase: hostRuntime.phase,
          capability: hostRuntime.capability,
        },
      });
}

function evaluateToolUseVerdict({ payload = {}, hostRuntime }) {
  const unmanaged = buildManagedSessionVerdict(hostRuntime);
  if (unmanaged) {
    return unmanaged;
  }

  const inferred = inferToolAction(payload, hostRuntime);
  const capabilityCheck = validateSessionCapability(hostRuntime, hostRuntime.session_capability);
  const requiredArtifacts = hostRuntime.required_preflight_outputs || DEFAULT_REQUIRED_PREFLIGHT;
  const artifactState = collectArtifactState({
    hostRuntime,
    artifacts: payload.artifacts || {},
    requiredArtifacts,
  });
  const skillTransition = evaluateSkillTransition(hostRuntime, artifactState.artifacts.dispatch_manifest, payload);

  if (!capabilityCheck.valid) {
    return buildGovernanceVerdict('pre_tool_use', {
      gate_result: 'blocked',
      allowed_to_continue: false,
      reason: capabilityCheck.reason,
      required_artifacts: requiredArtifacts,
      missing_artifacts: artifactState.missing_artifacts,
      allowed_actions: hostRuntime.allowed_actions || [],
      session: {
        session_id: hostRuntime.session_id,
        route_id: hostRuntime.route_id,
        phase: hostRuntime.phase,
        capability: hostRuntime.capability,
      },
      action: inferred.action,
      command: inferred.command,
      diagnostics: {
        inferred_action: inferred,
        runtime_gate_status: hostRuntime.runtime_gate_status,
      },
      message: 'Tool use is blocked because the session capability is invalid or missing.',
    });
  }

  if (artifactState.missing_artifacts.length > 0) {
    return buildGovernanceVerdict('pre_tool_use', {
      gate_result: 'blocked',
      allowed_to_continue: false,
      reason: 'required_runtime_artifacts_missing',
      required_artifacts: requiredArtifacts,
      missing_artifacts: artifactState.missing_artifacts,
      allowed_actions: hostRuntime.allowed_actions || [],
      session: {
        session_id: hostRuntime.session_id,
        route_id: hostRuntime.route_id,
        phase: hostRuntime.phase,
        capability: hostRuntime.capability,
      },
      action: inferred.action,
      command: inferred.command,
      diagnostics: {
        inferred_action: inferred,
        runtime_gate_status: hostRuntime.runtime_gate_status,
      },
      message: 'Tool use is blocked because required runtime artifacts are missing.',
    });
  }

  if (skillTransition && skillTransition.gate_result !== 'ready') {
    return buildGovernanceVerdict('pre_tool_use', {
      gate_result: 'blocked',
      allowed_to_continue: false,
      reason: skillTransition.reason,
      required_artifacts: requiredArtifacts,
      missing_artifacts: [],
      allowed_actions: hostRuntime.allowed_actions || [],
      session: {
        session_id: hostRuntime.session_id,
        route_id: hostRuntime.route_id,
        phase: hostRuntime.phase,
        capability: hostRuntime.capability,
      },
      diagnostics: {
        governed_skill: skillTransition.governed_skill,
        expected_next_skill: skillTransition.expected_next_skill || null,
        expected_phase: skillTransition.expected_phase || null,
      },
      message: 'Tool use is blocked because the governed skill order does not match the dispatch manifest.',
    });
  }

  if (hostRuntime.runtime_gate_status !== 'ready') {
    return buildGovernanceVerdict('pre_tool_use', {
      gate_result: hostRuntime.runtime_gate_status === 'declined' ? 'declined' : 'blocked',
      allowed_to_continue: false,
      reason: 'runtime_gate_not_ready_for_tool_use',
      required_artifacts: requiredArtifacts,
      missing_artifacts: [],
      allowed_actions: hostRuntime.allowed_actions || [],
      session: {
        session_id: hostRuntime.session_id,
        route_id: hostRuntime.route_id,
        phase: hostRuntime.phase,
        capability: hostRuntime.capability,
      },
      action: inferred.action,
      command: inferred.command,
      diagnostics: {
        inferred_action: inferred,
        runtime_gate_status: hostRuntime.runtime_gate_status,
      },
      message: 'Tool use is blocked because the runtime gate is not ready.',
    });
  }

  if (inferred.action === 'unmapped_tool_event') {
    if (inferred.risk_level === 'low') {
      return buildGovernanceVerdict('pre_tool_use', {
        gate_result: 'not_applicable',
        allowed_to_continue: true,
        reason: 'unmapped_low_risk_tool_event_passthrough',
        host_status: 'not_applicable',
        required_artifacts: requiredArtifacts,
        missing_artifacts: [],
        allowed_actions: hostRuntime.allowed_actions || [],
        session: {
          session_id: hostRuntime.session_id,
          route_id: hostRuntime.route_id,
          phase: hostRuntime.phase,
          capability: hostRuntime.capability,
        },
        action: inferred.action,
        command: inferred.command,
        diagnostics: {
          inferred_action: inferred,
          runtime_gate_status: hostRuntime.runtime_gate_status,
        },
        message: 'Low-risk unmapped tool event passes through.',
      });
    }
    return buildGovernanceVerdict('pre_tool_use', {
      gate_result: 'blocked',
      allowed_to_continue: false,
      reason: 'unmapped_high_risk_tool_event_denied',
      required_artifacts: requiredArtifacts,
      missing_artifacts: [],
      allowed_actions: hostRuntime.allowed_actions || [],
      session: {
        session_id: hostRuntime.session_id,
        route_id: hostRuntime.route_id,
        phase: hostRuntime.phase,
        capability: hostRuntime.capability,
      },
      action: inferred.action,
      command: inferred.command,
      diagnostics: {
        inferred_action: inferred,
        runtime_gate_status: hostRuntime.runtime_gate_status,
      },
      message: 'High-risk unmapped tool event is denied.',
    });
  }

  const gate = gateToolAction({
    action: inferred.action,
    hostRuntime,
    command: inferred.command,
    targetPaths: inferred.target_paths || [],
  });
  return buildGovernanceVerdict('pre_tool_use', {
    gate_result: gate.gate_result,
    allowed_to_continue: gate.gate_result === 'ready',
    reason: gate.reason,
    required_artifacts: requiredArtifacts,
    missing_artifacts: [],
    allowed_actions: hostRuntime.allowed_actions || [],
    session: {
      session_id: hostRuntime.session_id,
      route_id: hostRuntime.route_id,
      phase: hostRuntime.phase,
      capability: hostRuntime.capability,
    },
    action: inferred.action,
    command: inferred.command,
    diagnostics: {
      inferred_action: inferred,
      runtime_gate_status: hostRuntime.runtime_gate_status,
    },
    message: gate.gate_result === 'ready'
      ? 'Tool use is allowed by cutepower runtime gate.'
      : 'Tool use is blocked by cutepower runtime gate.',
  });
}

function evaluateStopGate({ hostRuntime, artifacts = {} }) {
  if (!hostRuntime || !hostRuntime.managed_by_cutepower) {
    return buildGovernanceVerdict('stop', {
      gate_result: 'not_applicable',
      allowed_to_continue: false,
      reason: 'cutepower_governance_not_active_for_session',
      host_status: 'not_applicable',
      session: hostRuntime
        ? {
            session_id: hostRuntime.session_id,
            route_id: hostRuntime.route_id,
            phase: hostRuntime.phase,
            capability: hostRuntime.capability,
          }
        : null,
      completion_gate: null,
      message: 'cutepower governance is not active for this session.',
    });
  }

  const preflight = collectArtifactState({
    hostRuntime,
    artifacts,
    requiredArtifacts: DEFAULT_REQUIRED_PREFLIGHT,
  });
  const closure = collectArtifactState({
    hostRuntime,
    artifacts,
    requiredArtifacts: [
      'evidence_manifest',
      'review_decision',
      'writeback_receipt_or_writeback_declined',
      'terminal_phase',
    ],
  });
  const evidenceStatus = artifactStatus(closure.artifacts.evidence_manifest);
  const reviewStatus = artifactStatus(closure.artifacts.review_decision);
  const terminalPhase = closure.artifacts.terminal_phase || null;
  const hasWritebackReceipt = Boolean(closure.artifacts.writeback_receipt);
  const hasWritebackDeclined = Boolean(closure.artifacts.writeback_declined);
  const missingArtifacts = [
    ...preflight.missing_artifacts,
    ...closure.missing_artifacts,
  ];
  const functionalReviewActive = isFunctionalReviewSession(hostRuntime, {
    ...artifacts,
    task_profile: preflight.artifacts.task_profile,
  });
  let reviewValidation = null;

  if (functionalReviewActive) {
    const functionalReviewState = collectArtifactState({
      hostRuntime,
      artifacts,
      requiredArtifacts: FUNCTIONAL_REVIEW_REQUIRED_ARTIFACTS,
    });
    missingArtifacts.push(...functionalReviewState.missing_artifacts);
    reviewValidation = validateFunctionalReviewArtifacts(functionalReviewState.artifacts);
    if (reviewValidation.required_artifacts.length > 0) {
      for (const artifactName of functionalReviewState.missing_artifacts) {
        if (!missingArtifacts.includes(artifactName)) {
          missingArtifacts.push(artifactName);
        }
      }
    }
  }

  if (
    preflight.missing_artifacts.length === 0
    && evidenceStatus === 'blocked'
    && reviewStatus === 'blocked'
    && hasWritebackDeclined
    && terminalPhase === 'blocked_closed'
    && (!functionalReviewActive || (
      reviewValidation
      && reviewValidation.completion_ready === false
      && reviewValidation.coverage_summary.blocker_gaps > 0
      && reviewValidation.missing_declared_gaps.length === 0
      && reviewValidation.compliance_issues.length === 0
      && reviewValidation.decision_issues.length === 0
    ))
    && missingArtifacts.length === 0
  ) {
    return buildGovernanceVerdict('stop', {
      gate_result: 'ready',
      host_status: 'completed',
      allowed_to_continue: false,
      reason: 'blocked_review_terminal_state_closed',
      required_artifacts: [
        ...DEFAULT_REQUIRED_PREFLIGHT,
        'evidence_manifest',
        'review_decision',
        'writeback_receipt_or_writeback_declined',
        'terminal_phase',
      ],
      missing_artifacts: [],
      allowed_actions: hostRuntime.allowed_actions || [],
      session: {
        session_id: hostRuntime.session_id,
        route_id: hostRuntime.route_id,
        phase: hostRuntime.phase,
        capability: hostRuntime.capability,
      },
      completion_gate: {
        terminal_phase: terminalPhase,
        terminal_outcome: 'blocked',
      },
      diagnostics: functionalReviewActive ? { review_validation: reviewValidation } : {},
      message: 'Completion gate recorded a blocked terminal state.',
    });
  }

  if (
    preflight.missing_artifacts.length === 0
    && evidenceStatus === 'complete'
    && reviewStatus === 'approved'
    && (hasWritebackDeclined || hasWritebackReceipt)
    && terminalPhase === 'closed'
    && (!functionalReviewActive || (reviewValidation && reviewValidation.completion_ready))
    && missingArtifacts.length === 0
  ) {
    return buildGovernanceVerdict('stop', {
      gate_result: 'ready',
      host_status: 'completed',
      allowed_to_continue: false,
      reason: 'review_terminal_state_closed',
      required_artifacts: [
        ...DEFAULT_REQUIRED_PREFLIGHT,
        'evidence_manifest',
        'review_decision',
        'writeback_receipt_or_writeback_declined',
        'terminal_phase',
      ],
      missing_artifacts: [],
      allowed_actions: hostRuntime.allowed_actions || [],
      session: {
        session_id: hostRuntime.session_id,
        route_id: hostRuntime.route_id,
        phase: hostRuntime.phase,
        capability: hostRuntime.capability,
      },
      completion_gate: {
        terminal_phase: terminalPhase,
        terminal_outcome: 'completed',
      },
      diagnostics: functionalReviewActive ? { review_validation: reviewValidation } : {},
      message: 'Completion gate recorded a structured terminal state.',
    });
  }

  return buildGovernanceVerdict('stop', {
    gate_result: 'not_applicable',
    host_status: 'skipped',
    allowed_to_continue: false,
    reason: 'run_is_not_closed',
    required_artifacts: [
      ...DEFAULT_REQUIRED_PREFLIGHT,
      'evidence_manifest',
      'review_decision',
      'writeback_receipt_or_writeback_declined',
      'terminal_phase',
    ],
    missing_artifacts: missingArtifacts,
    allowed_actions: hostRuntime.allowed_actions || [],
    session: {
      session_id: hostRuntime.session_id,
      route_id: hostRuntime.route_id,
      phase: hostRuntime.phase,
      capability: hostRuntime.capability,
    },
    completion_gate: {
      terminal_phase: terminalPhase,
      terminal_outcome: null,
    },
    diagnostics: {
      runtime_gate_status: hostRuntime.runtime_gate_status,
      review_validation: reviewValidation,
    },
    message: 'Completion gate found incomplete cutepower artifacts; host closure is not completed.',
  });
}

module.exports = {
  buildBlockedTerminalArtifacts,
  collectArtifactState,
  evaluateStopGate,
  evaluateToolUseVerdict,
  extractToolMetadata,
  gateToolAction,
  inferToolAction,
  inferToolActionFromCommand,
  inferToolActionFromMetadata,
};
