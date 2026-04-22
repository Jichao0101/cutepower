#!/usr/bin/env node
'use strict';

const {
  buildHostRuntime,
  coerceHostRuntime,
} = require('./host-runtime');
const {
  buildRuntimeGate,
} = require('./task-intake');
const {
  buildBlockedTerminalArtifacts,
  evaluateStopGate,
  gateToolAction,
} = require('./runtime-gates');

const HOOK_SCHEMAS = Object.freeze({
  UserPromptSubmit: Object.freeze({
    required: ['hook_event', 'decision', 'status', 'session'],
  }),
  PreToolUse: Object.freeze({
    required: ['hook_event', 'decision', 'status', 'action', 'session'],
  }),
  Stop: Object.freeze({
    required: ['hook_event', 'decision', 'status', 'completion_gate', 'session'],
  }),
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
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.resume();
  });
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
  const json = stableStringify(normalized);
  process.stdout.write(`${json}\n`);
  return normalized;
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
    action: 'forbidden_business_context_read',
    reason: 'unmapped_tool_event_denied_in_explicit_cutepower_mode',
    command,
  };
}

function handleUserPromptSubmit(payload) {
  const intake = buildRuntimeGate(payload);
  const hostRuntime = buildHostRuntime({
    ...payload,
    runtime_gate: intake,
  });
  const ready = intake.status === 'ready';
  return {
    decision: ready ? 'allow' : 'deny',
    status: ready ? 'ready' : intake.status,
    reason: ready ? 'runtime_gate_ready' : 'runtime_gate_not_ready',
    session: {
      session_id: hostRuntime.session_id,
      route_id: hostRuntime.route_id,
      phase: hostRuntime.phase,
      capability: hostRuntime.capability,
    },
    runtime_gate: intake,
  };
}

function handlePreToolUse(payload) {
  const hostRuntime = coerceHostRuntime(payload);
  const inferred = inferActionFromHookPayload(payload, hostRuntime);
  const gate = gateToolAction({
    action: inferred.action,
    hostRuntime,
    command: inferred.command,
  });
  return {
    decision: gate.decision,
    status: gate.status,
    reason: gate.reason || inferred.reason,
    action: inferred.action,
    command: inferred.command,
    session: {
      session_id: hostRuntime.session_id,
      route_id: hostRuntime.route_id,
      phase: hostRuntime.phase,
      capability: hostRuntime.capability,
    },
    guard_result: gate,
  };
}

function handleStop(payload) {
  const hostRuntime = coerceHostRuntime(payload);
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
  return {
    decision: completionGate.decision,
    status: completionGate.status,
    reason: completionGate.reason,
    session: {
      session_id: hostRuntime.session_id,
      route_id: hostRuntime.route_id,
      phase: hostRuntime.phase,
      capability: hostRuntime.capability,
    },
    completion_gate: completionGate,
    blocked_terminal_package: blockedArtifacts,
  };
}

async function main() {
  const hookName = process.argv[2] || 'Unknown';
  const stdin = await readStdin();
  const payload = parseJsonOrDefault(stdin, {});

  try {
    if (hookName === 'UserPromptSubmit') {
      emitHookResponse(hookName, handleUserPromptSubmit(payload));
      return;
    }
    if (hookName === 'PreToolUse') {
      emitHookResponse(hookName, handlePreToolUse(payload));
      return;
    }
    if (hookName === 'Stop') {
      emitHookResponse(hookName, handleStop(payload));
      return;
    }
    emitHookResponse(hookName, {
      decision: 'deny',
      status: 'denied',
      reason: 'unsupported_hook_event',
      session: {
        session_id: payload.session_id || 'unknown-session',
        route_id: payload.route_id || null,
        phase: payload.phase || null,
        capability: null,
      },
    });
  } catch (error) {
    emitHookResponse(hookName, {
      decision: 'deny',
      status: 'error',
      reason: 'hook_handler_exception',
      error: {
        name: error.name,
        message: error.message,
      },
      session: {
        session_id: payload.session_id || 'unknown-session',
        route_id: payload.route_id || null,
        phase: payload.phase || null,
        capability: null,
      },
    });
    process.exitCode = 1;
  }
}

module.exports = {
  HOOK_SCHEMAS,
  emitHookResponse,
  handlePreToolUse,
  handleStop,
  handleUserPromptSubmit,
  inferActionFromHookPayload,
  parseJsonOrDefault,
  stableStringify,
};

if (require.main === module) {
  main();
}
