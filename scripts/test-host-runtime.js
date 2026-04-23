'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildHostRuntime,
  buildSessionCapability,
  coerceHostRuntime,
  validateSessionCapability,
} = require('./host-runtime');
const { writeArtifact } = require('./run-artifacts');

function testBuildHostRuntimeCarriesArtifactContract() {
  const runtime = buildHostRuntime({
    session_id: 's-runtime',
    prompt: 'strict read-only functional audit',
    evidence_collection_mode: 'read_only',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      container_access_authorized: true,
      allowed_paths: ['contracts/', 'scripts/'],
    },
  });
  assert.equal(runtime.route_id, 'explicit_read_only_functional_audit');
  assert.equal(runtime.phase, 'evidence_collection');
  assert.deepEqual(runtime.required_preflight_outputs, [
    'task_profile',
    'route_resolution',
    'runtime_gate',
  ]);
}

function testCoerceHostRuntimePreservesReadOnlyAuditCapability() {
  const runtime = coerceHostRuntime({
    host_runtime: {
      session_id: 's-coerce',
      route_id: 'explicit_read_only_functional_audit',
      phase: 'evidence_collection',
      capability: 'functional_audit_read_only',
      allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
      allowed_paths: ['contracts/', 'scripts/'],
      evidence_collection_mode: 'read_only',
    },
  });
  assert.equal(runtime.capability, 'functional_audit_read_only');
  assert.equal(runtime.evidence_collection_mode, 'read_only');
}

function testBuildHostRuntimeDoesNotPromoteLegacyRuntimeRepairPrompt() {
  const runtime = buildHostRuntime({
    session_id: 's-fix',
    prompt: 'codex runtime integration fix for explicit cutepower mode',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  });
  assert.equal(runtime.route_id, 'declined_general_execution');
  assert.equal(runtime.phase, 'intake');
  assert.equal(runtime.capability, null);
}

function testBuildHostRuntimeMarksNonGovernanceInputAsUnmanaged() {
  const runtime = buildHostRuntime({
    session_id: 's-general',
    prompt: 'hallo',
  });
  assert.equal(runtime.managed_by_cutepower, false);
}

function testBuildSessionCapabilityOnlyForReadyManagedRuntime() {
  const runtime = buildHostRuntime({
    session_id: 's-cap',
    prompt: 'strict read-only functional audit',
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-host-')),
    evidence_collection_mode: 'read_only',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      allowed_paths: ['contracts/', 'scripts/'],
    },
  });
  const capability = buildSessionCapability(runtime);
  assert.equal(capability.session_id, 's-cap');
  assert.equal(capability.route_id, 'explicit_read_only_functional_audit');
  assert.equal(validateSessionCapability(runtime, capability).valid, true);
}

function testCoerceHostRuntimeLoadsPersistedRuntimeGate() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-host-'));
  writeArtifact(path.join(workspaceRoot, '.cutepower'), 's-persisted', 'runtime_gate', {
    status: 'ready',
    route_resolution: {
      route_id: 'explicit_read_only_functional_audit',
      phase: 'evidence_collection',
    },
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['scripts/'],
    required_preflight_outputs: ['task_profile', 'route_resolution', 'runtime_gate'],
  });
  const runtime = coerceHostRuntime({
    session_id: 's-persisted',
    cwd: workspaceRoot,
  });
  assert.equal(runtime.route_id, 'explicit_read_only_functional_audit');
  assert.equal(runtime.runtime_gate_status, 'ready');
}

function run() {
  testBuildHostRuntimeCarriesArtifactContract();
  testCoerceHostRuntimePreservesReadOnlyAuditCapability();
  testBuildHostRuntimeDoesNotPromoteLegacyRuntimeRepairPrompt();
  testBuildHostRuntimeMarksNonGovernanceInputAsUnmanaged();
  testBuildSessionCapabilityOnlyForReadyManagedRuntime();
  testCoerceHostRuntimeLoadsPersistedRuntimeGate();
  process.stdout.write('test-host-runtime: ok\n');
}

run();
