'use strict';

const assert = require('assert');
const { buildHostRuntime, coerceHostRuntime } = require('./host-runtime');

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

function testBuildHostRuntimeSupportsHookIntegrationFixCapability() {
  const runtime = buildHostRuntime({
    session_id: 's-fix',
    prompt: 'codex hook integration fix for explicit cutepower mode',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  });
  assert.equal(runtime.route_id, 'explicit_hook_integration_fix');
  assert.equal(runtime.phase, 'implementation');
  assert.equal(runtime.capability, 'hook_integration_fix');
}

function testBuildHostRuntimeMarksNonGovernanceInputAsUnmanaged() {
  const runtime = buildHostRuntime({
    session_id: 's-general',
    prompt: 'hallo',
  });
  assert.equal(runtime.managed_by_cutepower, false);
}

function run() {
  testBuildHostRuntimeCarriesArtifactContract();
  testCoerceHostRuntimePreservesReadOnlyAuditCapability();
  testBuildHostRuntimeSupportsHookIntegrationFixCapability();
  testBuildHostRuntimeMarksNonGovernanceInputAsUnmanaged();
  process.stdout.write('test-host-runtime: ok\n');
}

run();
