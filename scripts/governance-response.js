'use strict';

const DEFAULT_HOST_STATUS = Object.freeze({
  ready: 'ready',
  blocked: 'blocked',
  declined: 'declined',
  error: 'error',
  not_applicable: 'not_applicable',
});

const DECISION_STATUS_PAIRS = Object.freeze({
  allow: new Set(['ready', 'completed']),
  pass_through: new Set(['not_applicable', 'skipped']),
  deny: new Set(['blocked', 'declined', 'denied']),
  error: new Set(['error']),
});

function assertDecisionStatusPair(decision, status) {
  const allowedStatuses = DECISION_STATUS_PAIRS[decision];
  if (!allowedStatuses || !allowedStatuses.has(status)) {
    throw new Error(`Invalid governance decision/status pair: ${decision}/${status}`);
  }
}

function buildDecisionEnvelope(decision, status, reason, extras = {}) {
  assertDecisionStatusPair(decision, status);
  return {
    decision,
    status,
    reason,
    message: extras.message || reason,
    diagnostics: extras.diagnostics || {},
    ...extras,
  };
}

function ok(reason, extras = {}) {
  return buildDecisionEnvelope('allow', extras.status || 'ready', reason, extras);
}

function deny(reason, extras = {}) {
  return buildDecisionEnvelope('deny', extras.status || 'blocked', reason, extras);
}

function passThrough(reason, extras = {}) {
  return buildDecisionEnvelope('pass_through', extras.status || 'not_applicable', reason, extras);
}

function governanceError(reason, extras = {}) {
  return buildDecisionEnvelope('error', 'error', reason, extras);
}

function buildGovernanceVerdict(stage, overrides = {}) {
  const gateResult = overrides.gate_result || 'error';
  const requiredArtifacts = Array.isArray(overrides.required_artifacts)
    ? overrides.required_artifacts
    : [];
  const missingArtifacts = Array.isArray(overrides.missing_artifacts)
    ? overrides.missing_artifacts
    : [];
  return {
    gate_result: gateResult,
    stage,
    allowed_to_continue: Boolean(overrides.allowed_to_continue),
    reason: overrides.reason || 'unspecified_governance_reason',
    missing_artifacts: missingArtifacts,
    required_artifacts: requiredArtifacts,
    allowed_actions: Array.isArray(overrides.allowed_actions) ? overrides.allowed_actions : [],
    diagnostics: overrides.diagnostics || {},
    host_status: overrides.host_status || DEFAULT_HOST_STATUS[gateResult] || 'error',
    session: overrides.session || null,
    runtime_gate: overrides.runtime_gate || null,
    session_capability: overrides.session_capability || null,
    action: overrides.action || null,
    command: overrides.command || null,
    completion_gate: overrides.completion_gate || null,
    entry_action: overrides.entry_action || null,
    message: overrides.message || overrides.reason || 'unspecified_governance_reason',
  };
}

function mapVerdictToDecisionStatus(verdict) {
  const hostStatus = verdict.host_status || DEFAULT_HOST_STATUS[verdict.gate_result] || 'error';
  if (hostStatus === 'error') {
    return { decision: 'error', status: 'error' };
  }
  if (hostStatus === 'ready' || hostStatus === 'completed') {
    return { decision: 'allow', status: hostStatus };
  }
  if (hostStatus === 'not_applicable' || hostStatus === 'skipped') {
    return { decision: 'pass_through', status: hostStatus };
  }
  if (hostStatus === 'blocked' || hostStatus === 'declined' || hostStatus === 'denied') {
    return { decision: 'deny', status: hostStatus };
  }
  throw new Error(`Unsupported host status mapping: ${hostStatus}`);
}

module.exports = {
  assertDecisionStatusPair,
  buildDecisionEnvelope,
  buildGovernanceVerdict,
  DECISION_STATUS_PAIRS,
  deny,
  governanceError,
  mapVerdictToDecisionStatus,
  ok,
  passThrough,
};
