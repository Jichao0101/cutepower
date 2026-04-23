'use strict';

function buildHookResponse(decision, status, reason, extras = {}) {
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
  return buildHookResponse('allow', 'ready', reason, extras);
}

function deny(reason, extras = {}) {
  return buildHookResponse('deny', extras.status || 'blocked', reason, extras);
}

function passThrough(reason, extras = {}) {
  return buildHookResponse('pass_through', extras.status || 'not_applicable', reason, extras);
}

function hookError(reason, extras = {}) {
  return buildHookResponse(extras.decision || 'deny', 'error', reason, extras);
}

module.exports = {
  buildHookResponse,
  deny,
  hookError,
  ok,
  passThrough,
};
