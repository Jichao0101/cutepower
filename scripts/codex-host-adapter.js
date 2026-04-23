'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildHostRuntime,
  buildSessionCapability,
  coerceHostRuntime,
} = require('./host-runtime');
const {
  assertDecisionStatusPair,
  buildGovernanceVerdict,
  mapVerdictToDecisionStatus,
} = require('./hook-response');
const {
  analyzeCutepowerIntent,
  evaluateIntake,
  extractPromptText,
} = require('./task-intake');
const {
  buildBlockedTerminalArtifacts,
  evaluateStopGate,
  evaluateToolUseVerdict,
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

function normalizeHookName(rawHookName) {
  if (!rawHookName) {
    return 'Unknown';
  }
  return HOOK_NAME_ALIASES[String(rawHookName)] || rawHookName;
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
  process.stdout.write(`${JSON.stringify(normalized)}\n`);
  return normalized;
}

function writeHookLog(message, details) {
  const suffix = details ? ` ${details}` : '';
  process.stderr.write(`[codex-hooks] ${message}${suffix}\n`);
}

function detectRepoState(payload = {}) {
  const cwd = path.resolve(payload.cwd || payload.workspace_root || payload.repo_root || process.cwd());
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

function buildPassThroughVerdict(stage, payload, hostRuntime, reason, diagnostics = {}) {
  return buildGovernanceVerdict(stage, {
    gate_result: 'not_applicable',
    host_status: stage === 'stop' ? 'not_applicable' : 'not_applicable',
    allowed_to_continue: stage !== 'stop',
    reason,
    session: hostRuntime
      ? {
          session_id: hostRuntime.session_id,
          route_id: hostRuntime.route_id,
          phase: hostRuntime.phase,
          capability: hostRuntime.capability,
        }
      : {
          session_id: payload.session_id || payload.sessionId || 'unknown-session',
          route_id: payload.route_id || null,
          phase: payload.phase || null,
          capability: payload.capability || null,
        },
    diagnostics,
    entry_action: stage === 'user_prompt_submit' ? 'pass_through' : null,
    message: reason,
  });
}

function adjudicateUserPromptSubmit(payload) {
  const takeover = shouldTakeOverWithCutepower(payload);
  if (!takeover.should_take_over) {
    return buildPassThroughVerdict(
      'user_prompt_submit',
      payload,
      null,
      'non_governance_prompt_passthrough',
      {
        prompt: extractPromptText(payload),
        repo_state: takeover.repo_state,
        intent: takeover.intent,
      }
    );
  }

  const verdict = evaluateIntake(payload);
  const hostRuntime = buildHostRuntime({
    ...payload,
    session_id: verdict.session.session_id,
    runtime_gate: verdict.runtime_gate,
  });
  return {
    ...verdict,
    session_capability: verdict.allowed_to_continue
      ? buildSessionCapability(hostRuntime)
      : null,
    diagnostics: {
      ...verdict.diagnostics,
      prompt: extractPromptText(payload),
      repo_state: takeover.repo_state,
      intent: takeover.intent,
      matched_conditions: takeover.reasons,
    },
  };
}

function adjudicatePreToolUse(payload) {
  const hostRuntime = coerceHostRuntime(payload);
  return evaluateToolUseVerdict({
    payload,
    hostRuntime,
  });
}

function adjudicateStop(payload) {
  const hostRuntime = coerceHostRuntime(payload);
  const verdict = evaluateStopGate({
    hostRuntime,
    artifacts: payload.artifacts || payload,
  });
  const blockedTerminalPackage = verdict.reason === 'blocked_review_terminal_state_closed'
    ? buildBlockedTerminalArtifacts({
        sessionId: hostRuntime.session_id,
        routeId: hostRuntime.route_id,
        blockedReason: verdict.reason,
      })
    : null;
  return {
    ...verdict,
    diagnostics: {
      ...verdict.diagnostics,
      missing_artifacts: verdict.missing_artifacts,
    },
    blocked_terminal_package: blockedTerminalPackage,
  };
}

function mapVerdictToHostResponse(hookName, verdict) {
  const pair = mapVerdictToDecisionStatus(verdict);
  const base = {
    decision: pair.decision,
    status: pair.status,
    reason: verdict.reason,
    message: verdict.message,
    diagnostics: verdict.diagnostics || {},
    session: verdict.session,
  };

  if (hookName === 'UserPromptSubmit') {
    return {
      ...base,
      entry_action: verdict.entry_action || (verdict.allowed_to_continue ? 'take_over_for_cutepower' : 'legal_block'),
      runtime_gate: verdict.runtime_gate,
      session_capability: verdict.session_capability,
    };
  }
  if (hookName === 'PreToolUse') {
    return {
      ...base,
      action: verdict.action,
      command: verdict.command,
      guard_result: {
        gate_result: verdict.gate_result,
        allowed_to_continue: verdict.allowed_to_continue,
        required_artifacts: verdict.required_artifacts,
        missing_artifacts: verdict.missing_artifacts,
      },
    };
  }
  if (hookName === 'Stop') {
    return {
      ...base,
      completion_gate: verdict.completion_gate,
      blocked_terminal_package: verdict.blocked_terminal_package || null,
    };
  }
  return base;
}

function runHook(hookName, payload) {
  if (hookName === 'UserPromptSubmit') {
    return adjudicateUserPromptSubmit(payload);
  }
  if (hookName === 'PreToolUse') {
    return adjudicatePreToolUse(payload);
  }
  if (hookName === 'Stop') {
    return adjudicateStop(payload);
  }
  return buildPassThroughVerdict(
    'pre_tool_use',
    payload,
    null,
    'unsupported_hook_event',
    { requested_hook_event: hookName }
  );
}

function runCli(rawHookName, rawInput) {
  const hookName = normalizeHookName(rawHookName);
  const payload = parseJsonOrDefault(rawInput == null ? readStdin() : rawInput, {});

  try {
    const verdict = runHook(hookName, payload);
    emitHookResponse(hookName, mapVerdictToHostResponse(hookName, verdict));
    return verdict.gate_result === 'error' ? 1 : 0;
  } catch (error) {
    writeHookLog(`${hookName} error`, error && error.stack ? error.stack : String(error));
    const errorVerdict = buildGovernanceVerdict(
      hookName === 'UserPromptSubmit'
        ? 'user_prompt_submit'
        : hookName === 'Stop'
          ? 'stop'
          : 'pre_tool_use',
      {
        gate_result: 'error',
        allowed_to_continue: false,
        reason: 'hook_handler_exception',
        session: {
          session_id: payload.session_id || payload.sessionId || 'unknown-session',
          route_id: payload.route_id || null,
          phase: payload.phase || null,
          capability: payload.capability || null,
        },
        diagnostics: {
          error_message: error && error.message ? error.message : String(error),
        },
        completion_gate: hookName === 'Stop' ? null : undefined,
        entry_action: hookName === 'UserPromptSubmit' ? 'legal_block' : undefined,
      }
    );
    emitHookResponse(hookName, mapVerdictToHostResponse(hookName, errorVerdict));
    return 1;
  }
}

module.exports = {
  detectRepoState,
  mapVerdictToHostResponse,
  normalizeHookName,
  runCli,
  runHook,
  shouldTakeOverWithCutepower,
};
