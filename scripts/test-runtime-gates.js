'use strict';

const assert = require('assert');
const {
  buildBlockedTerminalArtifacts,
  evaluateStopGate,
  gateToolAction,
} = require('./runtime-gates');

function testAuthorizedBusinessReadAllowedInEvidenceCollection() {
  const result = gateToolAction({
    action: 'authorized_business_context_read',
    command: 'sed -n 1,40p contracts/gate-matrix.md',
    hostRuntime: {
      phase: 'evidence_collection',
      evidence_collection_mode: 'read_only',
      allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
      allowed_paths: ['contracts/', 'scripts/'],
    },
  });
  assert.equal(result.decision, 'allow');
}

function testWritebackOrReviewerEscalationStillDenied() {
  const result = gateToolAction({
    action: 'forbidden_business_context_read',
    command: 'node scripts/writeback.js',
    hostRuntime: {
      phase: 'evidence_collection',
      evidence_collection_mode: 'read_only',
      allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
      allowed_paths: ['contracts/', 'scripts/'],
    },
  });
  assert.equal(result.decision, 'deny');
}

function testBlockedReviewCanClose() {
  const artifacts = buildBlockedTerminalArtifacts({
    sessionId: 's-blocked',
    routeId: 'explicit_read_only_functional_audit',
    blockedReason: 'runtime_integration_defect',
  });
  const result = evaluateStopGate({
    hostRuntime: {
      session_id: 's-blocked',
      route_id: 'explicit_read_only_functional_audit',
    },
    artifacts,
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.status, 'completed');
  assert.equal(result.terminal_phase, 'blocked_closed');
  assert.equal(result.terminal_outcome, 'blocked');
}

function testMissingArtifactsStillBlocked() {
  const result = evaluateStopGate({
    hostRuntime: {
      session_id: 's-missing',
      route_id: 'explicit_read_only_functional_audit',
    },
    artifacts: {},
  });
  assert.equal(result.decision, 'pass_through');
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'run_is_not_closed');
}

function testRepoLocalVerificationExecAllowedForIntegrationFix() {
  const result = gateToolAction({
    action: 'repo_local_verification_exec',
    command: 'node scripts/test-codex-hooks.js',
    hostRuntime: {
      phase: 'implementation',
      evidence_collection_mode: 'implementation',
      allowed_actions: [
        'runtime_discovery_read',
        'authorized_business_context_read',
        'repo_local_verification_exec',
      ],
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  });
  assert.equal(result.decision, 'allow');
}

function run() {
  testAuthorizedBusinessReadAllowedInEvidenceCollection();
  testWritebackOrReviewerEscalationStillDenied();
  testBlockedReviewCanClose();
  testMissingArtifactsStillBlocked();
  testRepoLocalVerificationExecAllowedForIntegrationFix();
  process.stdout.write('test-runtime-gates: ok\n');
}

run();
