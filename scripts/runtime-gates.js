'use strict';

const fs = require('fs');
const path = require('path');

const { artifactPath } = require('./run-artifacts');
const { buildGovernanceVerdict } = require('./hook-response');
const { validateSessionCapability } = require('./host-runtime');

const DEFAULT_REQUIRED_PREFLIGHT = Object.freeze([
  'task_profile',
  'route_resolution',
  'runtime_gate',
]);

function includesAction(hostRuntime, action) {
  return Array.isArray(hostRuntime.allowed_actions)
    && hostRuntime.allowed_actions.includes(action);
}

function pathAllowed(hostRuntime, command) {
  return (hostRuntime.allowed_paths || []).some((allowedPath) => command.includes(allowedPath));
}

function gateToolAction({ action, hostRuntime, command }) {
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
    if (!['evidence_collection', 'implementation'].includes(hostRuntime.phase)) {
      return {
        gate_result: 'blocked',
        reason: 'authorized_business_context_read_outside_evidence_collection_phase',
      };
    }
    if (!['read_only', 'implementation'].includes(hostRuntime.evidence_collection_mode)) {
      return {
        gate_result: 'blocked',
        reason: 'authorized_business_context_read_requires_read_only_evidence_collection_mode',
      };
    }
    if (!pathAllowed(hostRuntime, command)) {
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
    evidence_manifest: {
      session_id: sessionId,
      route_id: routeId,
      status: 'blocked',
      reason: blockedReason,
    },
    review_decision: {
      session_id: sessionId,
      route_id: routeId,
      decision: 'blocked',
      reason: blockedReason,
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
  const command = getCommand(payload).trim();
  if (!command) {
    return {
      action: 'runtime_discovery_read',
      reason: 'empty_command_treated_as_runtime_discovery',
      command,
      risk_level: 'low',
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
      risk_level: 'low',
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
        risk_level: 'low',
      };
    }
    return {
      action: 'unmapped_tool_event',
      reason: 'git_mutation_or_unknown_git_command',
      command,
      risk_level: 'high',
    };
  }

  if (readOnlyVerbs.has(verb)) {
    if (!commandTargetsRepoEvidence) {
      return {
        action: 'runtime_discovery_read',
        reason: 'read_only_command_without_business_context_target',
        command,
        risk_level: 'low',
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
        risk_level: 'low',
      };
    }
    return {
      action: 'forbidden_business_context_read',
      reason: 'business_context_read_missing_explicit_authorization_or_route',
      command,
      risk_level: 'low',
    };
  }

  if (verb === 'node' && isRepoLocalRegressionTest) {
    return {
      action: 'repo_local_verification_exec',
      reason: 'repo_local_regression_test_allowed_for_verification',
      command,
      risk_level: 'high',
    };
  }

  if (mutatingVerbs.has(verb)) {
    return {
      action: 'unmapped_tool_event',
      reason: 'mutating_or_unreviewed_command_denied_in_hook_layer',
      command,
      risk_level: 'high',
    };
  }

  return {
    action: 'unmapped_tool_event',
    reason: 'unmapped_tool_event',
    command,
    risk_level: 'high',
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

  if (
    preflight.missing_artifacts.length === 0
    && evidenceStatus === 'blocked'
    && reviewStatus === 'blocked'
    && hasWritebackDeclined
    && terminalPhase === 'blocked_closed'
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
      message: 'Stop hook completed with a blocked terminal state.',
    });
  }

  if (
    preflight.missing_artifacts.length === 0
    && evidenceStatus === 'complete'
    && reviewStatus === 'approved'
    && (hasWritebackDeclined || hasWritebackReceipt)
    && terminalPhase === 'closed'
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
      message: 'Stop hook completed with a structured terminal state.',
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
    },
    message: 'Stop hook found incomplete cutepower artifacts; host closure is not completed.',
  });
}

module.exports = {
  buildBlockedTerminalArtifacts,
  collectArtifactState,
  evaluateStopGate,
  evaluateToolUseVerdict,
  gateToolAction,
  inferToolAction,
};
