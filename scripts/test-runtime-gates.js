'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeArtifact } = require('./run-artifacts');
const {
  buildBlockedTerminalArtifacts,
  evaluateStopGate,
  evaluateToolUseVerdict,
  gateToolAction,
} = require('./runtime-gates');

function makeHostRuntime(overrides = {}) {
  return {
    session_id: 's-runtime',
    workspace_root: overrides.workspace_root || null,
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
    required_preflight_outputs: ['task_profile', 'route_resolution', 'runtime_gate'],
    managed_by_cutepower: true,
    runtime_gate_status: 'ready',
    session_capability: {
      session_id: 's-runtime',
      route_id: 'explicit_read_only_functional_audit',
      phase: 'evidence_collection',
      capability: 'functional_audit_read_only',
      allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
      required_artifacts: ['task_profile', 'route_resolution', 'runtime_gate'],
    },
    ...overrides,
  };
}

function seedPreflightArtifacts(workspaceRoot, sessionId, runtimeGateStatus = 'ready') {
  const artifactRoot = path.join(workspaceRoot, '.cutepower');
  writeArtifact(artifactRoot, sessionId, 'task_profile', { primary_type: 'functional_audit' });
  writeArtifact(artifactRoot, sessionId, 'route_resolution', { route_id: 'explicit_read_only_functional_audit' });
  writeArtifact(artifactRoot, sessionId, 'runtime_gate', {
    status: runtimeGateStatus,
    route_resolution: { route_id: 'explicit_read_only_functional_audit' },
  });
}

function testAuthorizedBusinessReadAllowedInEvidenceCollection() {
  const result = gateToolAction({
    action: 'authorized_business_context_read',
    command: 'sed -n 1,40p contracts/gate-matrix.md',
    hostRuntime: makeHostRuntime(),
  });
  assert.equal(result.gate_result, 'ready');
}

function testHighRiskToolDeniedWithoutCapability() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateToolUseVerdict({
    payload: {
      command: 'bash -lc whoami',
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
      session_capability: null,
    }),
  });
  assert.equal(result.gate_result, 'blocked');
  assert.equal(result.reason, 'current_session_missing_valid_capability');
}

function testMissingRuntimeGateArtifactBlocksToolUse() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  writeArtifact(path.join(workspaceRoot, '.cutepower'), 's-runtime', 'task_profile', { primary_type: 'functional_audit' });
  writeArtifact(path.join(workspaceRoot, '.cutepower'), 's-runtime', 'route_resolution', { route_id: 'explicit_read_only_functional_audit' });
  const result = evaluateToolUseVerdict({
    payload: {
      command: 'sed -n 1,10p contracts/gate-matrix.yaml',
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
  });
  assert.equal(result.gate_result, 'blocked');
  assert.equal(result.reason, 'required_runtime_artifacts_missing');
  assert(result.missing_artifacts.includes('runtime_gate'));
}

function testUnmappedHighRiskToolDenied() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateToolUseVerdict({
    payload: {
      command: 'perl -e 1',
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
  });
  assert.equal(result.gate_result, 'blocked');
  assert.equal(result.reason, 'unmapped_high_risk_tool_event_denied');
}

function testBlockedReviewCanClose() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-stop-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const artifacts = buildBlockedTerminalArtifacts({
    sessionId: 's-runtime',
    routeId: 'explicit_read_only_functional_audit',
    blockedReason: 'runtime_integration_defect',
  });
  const result = evaluateStopGate({
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
    artifacts,
  });
  assert.equal(result.gate_result, 'ready');
  assert.equal(result.host_status, 'completed');
  assert.equal(result.completion_gate.terminal_outcome, 'blocked');
}

function testStopCannotCompleteWithoutReviewDecision() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-stop-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateStopGate({
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
    artifacts: {
      evidence_manifest: { status: 'complete' },
      terminal_phase: 'closed',
      writeback_declined: { status: 'declined' },
    },
  });
  assert.equal(result.gate_result, 'not_applicable');
  assert.equal(result.host_status, 'skipped');
  assert(result.missing_artifacts.includes('review_decision'));
}

function run() {
  testAuthorizedBusinessReadAllowedInEvidenceCollection();
  testHighRiskToolDeniedWithoutCapability();
  testMissingRuntimeGateArtifactBlocksToolUse();
  testUnmappedHighRiskToolDenied();
  testBlockedReviewCanClose();
  testStopCannotCompleteWithoutReviewDecision();
  process.stdout.write('test-runtime-gates: ok\n');
}

run();
