'use strict';

const DECISION_STATUS_PAIRS = Object.freeze({
  allow: new Set(['ready', 'completed']),
  pass_through: new Set(['not_applicable', 'skipped']),
  deny: new Set(['blocked', 'declined', 'denied']),
  error: new Set(['error']),
});

function assertDecisionStatusPair(decision, status) {
  const allowedStatuses = DECISION_STATUS_PAIRS[decision];
  if (!allowedStatuses || !allowedStatuses.has(status)) {
    throw new Error(`Invalid hook decision/status pair: ${decision}/${status}`);
  }
}

function buildHookResponse(decision, status, reason, extras = {}) {
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
  return buildHookResponse('allow', extras.status || 'ready', reason, extras);
}

function deny(reason, extras = {}) {
  return buildHookResponse('deny', extras.status || 'blocked', reason, extras);
}

function passThrough(reason, extras = {}) {
  return buildHookResponse('pass_through', extras.status || 'not_applicable', reason, extras);
}

function hookError(reason, extras = {}) {
  return buildHookResponse('error', 'error', reason, extras);
}

module.exports = {
  assertDecisionStatusPair,
  buildHookResponse,
  DECISION_STATUS_PAIRS,
  deny,
  hookError,
  ok,
  passThrough,
};
