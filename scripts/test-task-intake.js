'use strict';

const assert = require('assert');
const { analyzeCutepowerIntent, buildRuntimeGate } = require('./task-intake');

function testExplicitReadOnlyAuditGetsReadyGateWithAuthorization() {
  const gate = buildRuntimeGate({
    prompt: 'run a strict read-only functional audit over requirements and code evidence',
    evidence_collection_mode: 'read_only',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      container_access_authorized: true,
      allowed_paths: ['contracts/', 'scripts/'],
    },
  });
  assert.equal(gate.status, 'ready');
  assert.equal(gate.route_resolution.route_id, 'explicit_read_only_functional_audit');
  assert.deepEqual(gate.allowed_actions, [
    'runtime_discovery_read',
    'authorized_business_context_read',
  ]);
}

function testExplicitReadOnlyAuditBlocksWithoutAuthorization() {
  const gate = buildRuntimeGate({
    prompt: 'run a strict read-only functional audit over requirements and code evidence',
    evidence_collection_mode: 'read_only',
    authorization: {
      user_explicitly_authorized: false,
      project_paths_authorized: false,
    },
  });
  assert.equal(gate.status, 'blocked');
  assert.equal(gate.blocking_reasons[0], 'explicit_authorization_for_project_read_missing');
}

function testExplicitHookIntegrationFixGetsImplementationRoute() {
  const gate = buildRuntimeGate({
    prompt: 'do a Codex hook integration fix for this repo',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  });
  assert.equal(gate.status, 'ready');
  assert.equal(gate.route_resolution.route_id, 'explicit_hook_integration_fix');
  assert.deepEqual(gate.allowed_actions, [
    'runtime_discovery_read',
    'authorized_business_context_read',
    'repo_local_verification_exec',
  ]);
}

function testGeneralPromptDoesNotRequestCutepowerGovernance() {
  const intent = analyzeCutepowerIntent({
    prompt: 'Explain this repo',
  });
  assert.equal(intent.should_consider_cutepower, false);
}

function run() {
  testExplicitReadOnlyAuditGetsReadyGateWithAuthorization();
  testExplicitReadOnlyAuditBlocksWithoutAuthorization();
  testExplicitHookIntegrationFixGetsImplementationRoute();
  testGeneralPromptDoesNotRequestCutepowerGovernance();
  process.stdout.write('test-task-intake: ok\n');
}

run();
