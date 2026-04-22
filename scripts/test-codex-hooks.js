'use strict';

const assert = require('assert');
const {
  handlePreToolUse,
  handleStop,
  handleUserPromptSubmit,
  stableStringify,
} = require('./codex-hooks');

function parseHookJson(result) {
  return JSON.parse(stableStringify(result));
}

function testUserPromptSubmitAlwaysReturnsJsonReadyState() {
  const response = parseHookJson(handleUserPromptSubmit({
    prompt: 'codex hook integration fix for explicit cutepower mode',
    session_id: 's-user',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      container_access_authorized: true,
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  }));
  assert.equal(response.hook_event, undefined);
  assert.equal(response.decision, 'allow');
  assert.equal(response.status, 'ready');
  assert.equal(response.runtime_gate.capability, 'hook_integration_fix');
}

function testPreToolUseAllowsAuthorizedReadOnlyAuditEvidenceRead() {
  const response = parseHookJson(handlePreToolUse({
    command: 'sed -n 1,40p contracts/gate-matrix.md',
    session_id: 's-tool',
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
  }));
  assert.equal(response.decision, 'allow');
  assert.equal(response.action, 'authorized_business_context_read');
}

function testPreToolUseRejectsUnauthorizedBusinessRead() {
  const response = parseHookJson(handlePreToolUse({
    command: 'sed -n 1,40p contracts/gate-matrix.md',
    session_id: 's-deny',
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read'],
    allowed_paths: ['contracts/', 'scripts/'],
  }));
  assert.equal(response.decision, 'deny');
  assert.equal(response.action, 'forbidden_business_context_read');
}

function testStopReturnsBlockedTerminalPackage() {
  const response = parseHookJson(handleStop({
    session_id: 's-stop',
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
    artifacts: {
      evidence_manifest: { status: 'blocked' },
      review_decision: { decision: 'blocked' },
      writeback_declined: { status: 'declined' },
      terminal_phase: 'blocked_closed',
    },
  }));
  assert.equal(response.decision, 'allow');
  assert.equal(response.status, 'blocked');
  assert.equal(response.completion_gate.reason, 'blocked_review_terminal_state_closed');
}

function testPreToolUseAllowsRepoLocalRegressionExecution() {
  const response = parseHookJson(handlePreToolUse({
    cmd: 'node scripts/test-codex-hooks.js',
    session_id: 's-regression',
    route_id: 'explicit_hook_integration_fix',
    phase: 'implementation',
    capability: 'hook_integration_fix',
    evidence_collection_mode: 'implementation',
    allowed_actions: [
      'runtime_discovery_read',
      'authorized_business_context_read',
      'repo_local_verification_exec',
    ],
    allowed_paths: ['contracts/', 'scripts/', 'docs/'],
  }));
  assert.equal(response.decision, 'allow');
  assert.equal(response.action, 'repo_local_verification_exec');
}

function run() {
  testUserPromptSubmitAlwaysReturnsJsonReadyState();
  testPreToolUseAllowsAuthorizedReadOnlyAuditEvidenceRead();
  testPreToolUseRejectsUnauthorizedBusinessRead();
  testStopReturnsBlockedTerminalPackage();
  testPreToolUseAllowsRepoLocalRegressionExecution();
  process.stdout.write('test-codex-hooks: ok\n');
}

run();
