#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildHostRuntime,
  coerceHostRuntime,
} = require('./host-runtime');
const {
  assertDecisionStatusPair,
  deny,
  hookError,
  ok,
  passThrough,
} = require('./hook-response');
const {
  analyzeCutepowerIntent,
  buildRuntimeGate,
  extractPromptText,
} = require('./task-intake');
const {
  buildBlockedTerminalArtifacts,
  evaluateStopGate,
  gateToolAction,
} = require('./runtime-gates');

const HOOK_SCHEMAS = Object.freeze({
  UserPromptSubmit: Object.freeze({
    required: ['hook_event', 'decision', 'status', 'entry_action', 'session', 'diagnostics'],
  }),
  PreToolUse: Object.freeze({
    required: ['hook_event', 'decision', 'status', 'action', 'session', 'diagnostics'],
  }),
  Stop: Object.freeze({
    required: ['hook_event', 'decision', 'status', 'completion_gate', 'session', 'diagnostics'],
  }),
});

const HOOK_NAME_ALIASES = Object.freeze({
  'user-prompt-submit': 'UserPromptSubmit',
  userpromptsubmit: 'UserPromptSubmit',
  pretooluse: 'PreToolUse',
  'pre-tool-use': 'PreToolUse',
  stop: 'Stop',
});

function parseJsonOrDefault(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (error) {
    if (error && (error.code === 'EOF' || error.code === 'EAGAIN')) {
      return '';
    }
    throw error;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ensureSchemaFields(hookName, response) {
  const schema = HOOK_SCHEMAS[hookName];
  if (!schema) {
    return response;
  }
  for (const key of schema.required) {
    if (!(key in response)) {
      response[key] = null;
    }
  }
  return response;
}

function emitHookResponse(hookName, response) {
  const normalized = ensureSchemaFields(hookName, {
    hook_event: hookName,
    protocol_version: 'codex-hook-v1',
    ...response,
  });
  assertDecisionStatusPair(normalized.decision, normalized.status);
  const json = JSON.stringify(normalized);
  process.stdout.write(`${json}\n`);
  return normalized;
}

function writeHookLog(message, details) {
  const suffix = details ? ` ${details}` : '';
  process.stderr.write(`[codex-hooks] ${message}${suffix}\n`);
}

function normalizeHookName(rawHookName) {
  if (!rawHookName) {
    return 'Unknown';
  }
  return HOOK_NAME_ALIASES[String(rawHookName)] || rawHookName;
}

function buildSessionView(hostRuntime, fallbackPayload = {}) {
  return {
    session_id: hostRuntime.session_id || fallbackPayload.session_id || fallbackPayload.sessionId || 'unknown-session',
    route_id: hostRuntime.route_id || fallbackPayload.route_id || null,
    phase: hostRuntime.phase || fallbackPayload.phase || null,
    capability: hostRuntime.capability || fallbackPayload.capability || null,
  };
}

function getCommand(payload) {
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

function getWorkingDirectory(payload = {}) {
  return path.resolve(
    payload.cwd
    || payload.working_directory
    || payload.workspace_root
    || payload.repo_root
    || payload.project_root
    || (payload.input && (
      payload.input.cwd
      || payload.input.working_directory
      || payload.input.workspace_root
      || payload.input.repo_root
    ))
    || process.cwd()
  );
}

function detectRepoState(payload = {}) {
  const cwd = getWorkingDirectory(payload);
  const hasPath = (relativePath) => fs.existsSync(path.join(cwd, relativePath));
  const hasContractsDir = hasPath('contracts');
  const hasScriptsDir = hasPath('scripts');
  const hasPluginManifest = hasPath('.codex-plugin/plugin.json');
  const hasSkillsDir = hasPath('skills');
  const hasRunStateDir = hasPath('.cutepower/run');
  const isCutepowerActiveRepo = (
    (hasContractsDir && hasScriptsDir && hasPluginManifest)
    || (hasRunStateDir && (hasContractsDir || hasScriptsDir || hasSkillsDir))
  );

  return {
    cwd,
    has_contracts_dir: hasContractsDir,
    has_scripts_dir: hasScriptsDir,
    has_plugin_manifest: hasPluginManifest,
    has_skills_dir: hasSkillsDir,
    has_run_state_dir: hasRunStateDir,
    is_cutepower_active_repo: isCutepowerActiveRepo,
  };
}

function shouldTakeOverWithCutepower(payload = {}) {
  const repoState = detectRepoState(payload);
  const intent = analyzeCutepowerIntent(payload);
  const reasons = [];

  if (intent.is_explicit_cutepower_request) {
    reasons.push('explicit_cutepower_request');
  }
  if (repoState.is_cutepower_active_repo && intent.is_repo_governance_task) {
    reasons.push('repo_local_governance_task');
  }

  return {
    should_take_over: reasons.length > 0,
    repo_state: repoState,
    intent,
    reasons,
  };
}

function shouldEnforceCutepowerGovernance(payload = {}, hostRuntime) {
  if (payload.host_runtime && payload.host_runtime.managed_by_cutepower) {
    return true;
  }
  if (payload.runtime_gate && payload.runtime_gate.route_resolution) {
    return payload.runtime_gate.route_resolution.route_id !== 'declined_general_execution';
  }
  return Boolean(hostRuntime && hostRuntime.managed_by_cutepower);
}

function buildPassThroughResponse({
  payload = {},
  hostRuntime,
  reason,
  message,
  diagnostics = {},
  action = 'pass_through',
  status = 'not_applicable',
  ...extras
}) {
  const runtime = hostRuntime || buildHostRuntime(payload);
  return passThrough(reason, {
    status,
    message,
    entry_action: action,
    action,
    session: buildSessionView(runtime, payload),
    diagnostics,
    ...extras,
  });
}

function buildLegalBlockResponse({ hookName, payload = {}, hostRuntime, reason, runtimeGate = null, diagnostics = {}, action = null, message }) {
  const runtime = hostRuntime || buildHostRuntime(payload);
  const status = runtimeGate && runtimeGate.status === 'declined'
    ? 'declined'
    : 'blocked';
  return deny(reason, {
    status,
    message,
    entry_action: hookName === 'UserPromptSubmit' ? 'legal_block' : null,
    action,
    session: buildSessionView(runtime, payload),
    runtime_gate: runtimeGate,
    diagnostics,
  });
}

function buildHookErrorResponse({ payload = {}, hostRuntime, reason, message, diagnostics = {}, action = null, completionGate = null }) {
  const runtime = hostRuntime || buildHostRuntime(payload);
  return hookError(reason, {
    message,
    action,
    completion_gate: completionGate,
    session: buildSessionView(runtime, payload),
    diagnostics,
  });
}

function mapTopLevelStatus(status, fallback = 'blocked') {
  if (
    status === 'ready'
    || status === 'completed'
    || status === 'blocked'
    || status === 'declined'
    || status === 'denied'
    || status === 'not_applicable'
    || status === 'skipped'
    || status === 'error'
  ) {
    return status;
  }
  if (status === 'closed') {
    return 'completed';
  }
  if (status === 'denied') {
    return 'denied';
  }
  return fallback;
}

function inferActionFromHookPayload(payload, hostRuntime) {
  const command = getCommand(payload).trim();
  if (!command) {
    return {
      action: 'runtime_discovery_read',
      reason: 'empty_command_treated_as_runtime_discovery',
      command,
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
      };
    }
    return {
      action: 'forbidden_business_context_read',
      reason: 'git_mutation_or_unknown_git_command',
      command,
    };
  }

  if (readOnlyVerbs.has(verb)) {
    if (!commandTargetsRepoEvidence) {
      return {
        action: 'runtime_discovery_read',
        reason: 'read_only_command_without_business_context_target',
        command,
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
      };
    }
    return {
      action: 'forbidden_business_context_read',
      reason: 'business_context_read_missing_explicit_authorization_or_route',
      command,
    };
  }

  if (verb === 'node' && isRepoLocalRegressionTest) {
    return {
      action: 'repo_local_verification_exec',
      reason: 'repo_local_regression_test_allowed_for_verification',
      command,
    };
  }

  if (mutatingVerbs.has(verb)) {
    return {
      action: 'forbidden_business_context_read',
      reason: 'mutating_or_unreviewed_command_denied_in_hook_layer',
      command,
    };
  }

  return {
    action: 'unmapped_tool_event',
    reason: 'unmapped_tool_event',
    command,
  };
}

function handleUserPromptSubmit(payload) {
  const takeover = shouldTakeOverWithCutepower(payload);
  if (!takeover.should_take_over) {
    return buildPassThroughResponse({
      payload,
      reason: 'non_governance_prompt_passthrough',
      message: 'Prompt does not activate cutepower governance.',
      diagnostics: {
        mode: 'pass_through',
        prompt: extractPromptText(payload),
        repo_state: takeover.repo_state,
        intent: takeover.intent,
        matched_conditions: [],
      },
    });
  }

  const intake = buildRuntimeGate(payload);
  const hostRuntime = buildHostRuntime({
    ...payload,
    runtime_gate: intake,
  });
  const ready = intake.status === 'ready';
  const diagnostics = {
    mode: ready ? 'take_over_for_cutepower' : 'legal_block',
    prompt: extractPromptText(payload),
    repo_state: takeover.repo_state,
    intent: takeover.intent,
    matched_conditions: takeover.reasons,
    task_profile: intake.task_profile,
    route_resolution: intake.route_resolution,
    runtime_gate: intake,
  };
  if (!ready) {
    return buildLegalBlockResponse({
      hookName: 'UserPromptSubmit',
      payload,
      hostRuntime,
      reason: intake.status === 'declined'
        ? 'cutepower_takeover_requested_but_no_supported_route'
        : 'cutepower_takeover_blocked_by_runtime_gate',
      message: intake.status === 'declined'
        ? 'cutepower takeover was requested but no supported route matched.'
        : 'cutepower takeover is blocked by the runtime gate.',
      runtimeGate: intake,
      diagnostics,
    });
  }
  return ok('cutepower_takeover_ready', {
    message: 'cutepower takeover is ready.',
    entry_action: 'take_over_for_cutepower',
    session: buildSessionView(hostRuntime, payload),
    runtime_gate: intake,
    diagnostics,
  });
}

function handlePreToolUse(payload) {
  const hostRuntime = coerceHostRuntime(payload);
  if (!shouldEnforceCutepowerGovernance(payload, hostRuntime)) {
    return buildPassThroughResponse({
      payload,
      hostRuntime,
      reason: 'cutepower_governance_not_active_for_session',
      message: 'cutepower governance is not active for this session.',
      diagnostics: {
        mode: 'pass_through',
        managed_by_cutepower: false,
        repo_state: detectRepoState(payload),
      },
    });
  }
  const inferred = inferActionFromHookPayload(payload, hostRuntime);
  if (inferred.action === 'unmapped_tool_event') {
    return buildPassThroughResponse({
      payload,
      hostRuntime,
      reason: 'unmapped_tool_event',
      message: 'Tool event is not mapped by cutepower governance.',
      status: 'not_applicable',
      diagnostics: {
        mode: 'pass_through',
        managed_by_cutepower: true,
        repo_state: detectRepoState(payload),
        inferred_action: inferred,
        unmapped_tool_event_count: 1,
      },
    });
  }
  const gate = gateToolAction({
    action: inferred.action,
    hostRuntime,
    command: inferred.command,
  });
  const diagnostics = {
    mode: 'take_over_for_cutepower',
    managed_by_cutepower: true,
    repo_state: detectRepoState(payload),
    inferred_action: inferred,
  };
  if (gate.decision === 'allow') {
    return ok(gate.reason || inferred.reason, {
      message: 'Tool use is allowed by cutepower runtime gate.',
      action: inferred.action,
      command: inferred.command,
      session: buildSessionView(hostRuntime, payload),
      diagnostics,
      guard_result: gate,
    });
  }
  return deny(gate.reason || inferred.reason, {
    status: mapTopLevelStatus(gate.status),
    message: 'Tool use is blocked by cutepower runtime gate.',
    action: inferred.action,
    command: inferred.command,
    session: buildSessionView(hostRuntime, payload),
    diagnostics,
    guard_result: gate,
  });
}

function handleStop(payload) {
  const hostRuntime = coerceHostRuntime(payload);
  if (!shouldEnforceCutepowerGovernance(payload, hostRuntime)) {
    return buildPassThroughResponse({
      payload,
      hostRuntime,
      reason: 'cutepower_governance_not_active_for_session',
      message: 'cutepower governance is not active for this session.',
      diagnostics: {
        mode: 'pass_through',
        managed_by_cutepower: false,
        repo_state: detectRepoState(payload),
      },
    });
  }
  const completionGate = evaluateStopGate({
    hostRuntime,
    artifacts: payload.artifacts || payload,
  });
  const blockedArtifacts = completionGate.status === 'blocked'
    ? buildBlockedTerminalArtifacts({
        sessionId: hostRuntime.session_id,
        routeId: hostRuntime.route_id,
        blockedReason: completionGate.reason,
      })
    : null;
  const missingArtifacts = completionGate.required || [];
  const diagnostics = {
    mode: 'take_over_for_cutepower',
    managed_by_cutepower: true,
    repo_state: detectRepoState(payload),
    missing_artifacts: missingArtifacts,
    session_summary: {
      terminal_phase: completionGate.terminal_phase || null,
      route_id: hostRuntime.route_id,
      capability: hostRuntime.capability,
    },
    unmapped_events_count: payload.unmapped_events_count || 0,
    route_id: hostRuntime.route_id,
    capability: hostRuntime.capability,
  };
  if (completionGate.decision === 'allow') {
    return ok(completionGate.reason, {
      status: mapTopLevelStatus(completionGate.status, 'completed'),
      message: 'Stop hook completed with a structured cutepower terminal state.',
      entry_action: 'take_over_for_cutepower',
      session: buildSessionView(hostRuntime, payload),
      completion_gate: completionGate,
      blocked_terminal_package: blockedArtifacts,
      diagnostics,
    });
  }
  if (completionGate.decision === 'deny') {
    return deny(completionGate.reason, {
      status: mapTopLevelStatus(completionGate.status, 'blocked'),
      message: 'Stop hook is blocked by cutepower terminal-state validation.',
      action: 'legal_block',
      session: buildSessionView(hostRuntime, payload),
      completion_gate: completionGate,
      blocked_terminal_package: blockedArtifacts,
      diagnostics,
    });
  }
  return buildPassThroughResponse({
    payload,
    hostRuntime,
    reason: completionGate.reason,
    message: 'Stop hook found incomplete cutepower artifacts; host closure is not blocked.',
    status: mapTopLevelStatus(completionGate.status, 'skipped'),
    diagnostics,
    action: 'pass_through',
    completion_gate: completionGate,
    blocked_terminal_package: blockedArtifacts,
  });
}

function runHookHandler(hookName, payload = {}) {
  try {
    if (hookName === 'UserPromptSubmit') {
      return emitHookResponse(hookName, handleUserPromptSubmit(payload));
    }
    if (hookName === 'PreToolUse') {
      return emitHookResponse(hookName, handlePreToolUse(payload));
    }
    if (hookName === 'Stop') {
      return emitHookResponse(hookName, handleStop(payload));
    }
    return emitHookResponse(hookName, passThrough('unsupported_hook_event', {
      status: 'not_applicable',
      message: 'Hook event is not handled by cutepower.',
      session: buildSessionView({}, payload),
      diagnostics: {
        mode: 'pass_through',
        matched_conditions: ['unsupported_hook_event'],
      },
    }));
  } catch (error) {
    writeHookLog(`${hookName} error`, error.stack || error.message);
    process.exitCode = 1;
    const diagnostics = {
      mode: 'error',
      error: {
        name: error.name,
        message: error.message,
      },
    };
    const fallback = buildHookErrorResponse({
      payload,
      reason: 'hook_handler_exception',
      message: 'Hook handler raised an exception.',
      diagnostics,
    });
    const response = emitHookResponse(hookName, fallback);
    return response;
  }
}

function main() {
  const hookName = normalizeHookName(process.argv[2] || 'Unknown');
  const stdin = readStdin();
  const payload = parseJsonOrDefault(stdin, {});
  const response = runHookHandler(hookName, payload);
  if (response && response.process_exit_code) {
    process.exitCode = response.process_exit_code;
  }
}

module.exports = {
  HOOK_SCHEMAS,
  buildLegalBlockResponse,
  buildPassThroughResponse,
  detectRepoState,
  emitHookResponse,
  handlePreToolUse,
  handleStop,
  handleUserPromptSubmit,
  inferActionFromHookPayload,
  mapTopLevelStatus,
  parseJsonOrDefault,
  runHookHandler,
  shouldEnforceCutepowerGovernance,
  shouldTakeOverWithCutepower,
  stableStringify,
};

if (require.main === module) {
  main();
}
