'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hookModule = require('./codex-hooks');
const {
  handlePreToolUse,
  handleStop,
  handleUserPromptSubmit,
  runHookHandler,
  stableStringify,
} = hookModule;

function parseHookJson(result) {
  return JSON.parse(stableStringify(result));
}

function runAndParseHook(hookName, payload) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return parseHookJson(runHookHandler(hookName, payload));
  } finally {
    process.stdout.write = originalWrite;
  }
}

function makeRepoFixture({ active = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-hook-'));
  if (active) {
    fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), '{}\n', 'utf8');
  }
  return root;
}

function readSchema(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'));
}

function validateRequiredKeys(schema, value, schemaName) {
  for (const key of schema.required || []) {
    assert(Object.prototype.hasOwnProperty.call(value, key), `${schemaName} missing required key ${key}`);
  }
}

function testUserPromptSubmitPassesThroughHalloInNonCutepowerRepo() {
  const repoRoot = makeRepoFixture({ active: false });
  const response = parseHookJson(handleUserPromptSubmit({
    prompt: 'hallo',
    cwd: repoRoot,
    session_id: 's-hallo',
  }));
  assert.equal(response.decision, 'allow');
  assert.equal(response.status, 'pass_through');
  assert.equal(response.entry_action, 'pass_through');
  assert.deepEqual(response.diagnostics.matched_conditions, []);
}

function testUserPromptSubmitPassesThroughCommonPrompts() {
  const repoRoot = makeRepoFixture({ active: false });
  const prompts = ['hello', '你好', 'Explain this repo'];
  for (const prompt of prompts) {
    const response = parseHookJson(handleUserPromptSubmit({
      prompt,
      cwd: repoRoot,
      session_id: `s-${prompt}`,
    }));
    assert.equal(response.decision, 'allow');
    assert.equal(response.status, 'pass_through');
    assert.equal(response.entry_action, 'pass_through');
  }
}

function testUserPromptSubmitTakesOverExplicitCutepowerTask() {
  const repoRoot = makeRepoFixture({ active: false });
  const response = parseHookJson(handleUserPromptSubmit({
    prompt: 'strictly follow cutepower and do a codex hook integration fix',
    cwd: repoRoot,
    session_id: 's-user',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      container_access_authorized: true,
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  }));
  assert.equal(response.decision, 'allow');
  assert.equal(response.status, 'ready');
  assert.equal(response.entry_action, 'take_over_for_cutepower');
  assert.equal(response.runtime_gate.capability, 'hook_integration_fix');
  assert(response.diagnostics.matched_conditions.includes('explicit_cutepower_request'));
}

function testUserPromptSubmitTakesOverRepoLocalGovernanceTask() {
  const repoRoot = makeRepoFixture({ active: true });
  const response = parseHookJson(handleUserPromptSubmit({
    prompt: 'please run a review for this repo',
    cwd: repoRoot,
    session_id: 's-review',
  }));
  assert.equal(response.decision, 'deny');
  assert.equal(response.status, 'declined');
  assert.equal(response.entry_action, 'legal_block');
  assert(response.diagnostics.matched_conditions.includes('repo_local_governance_task'));
}

function testUserPromptSubmitFailSafePassThroughOnException() {
  const originalExistsSync = fs.existsSync;
  fs.existsSync = () => {
    throw new Error('forced existsSync failure');
  };
  try {
    const response = runAndParseHook('UserPromptSubmit', {
      prompt: 'hallo',
      session_id: 's-exception',
    });
    validateRequiredKeys(
      readSchema('schemas/hook-responses/user-prompt-submit.json'),
      response,
      'user-prompt-submit'
    );
    assert.equal(response.decision, 'allow');
    assert.equal(response.status, 'pass_through');
    assert.equal(response.reason, 'user_prompt_submit_fail_safe_passthrough');
    assert.equal(response.diagnostics.error.message, 'forced existsSync failure');
  } finally {
    fs.existsSync = originalExistsSync;
  }
}

function testPreToolUsePassesThroughWhenCutepowerInactive() {
  const repoRoot = makeRepoFixture({ active: false });
  const response = parseHookJson(handlePreToolUse({
    command: 'sed -n 1,40p README.md',
    cwd: repoRoot,
    session_id: 's-pass',
  }));
  assert.equal(response.decision, 'allow');
  assert.equal(response.status, 'pass_through');
  assert.equal(response.action, 'pass_through');
}

function testPreToolUseAllowsAuthorizedReadOnlyAuditEvidenceRead() {
  const response = runAndParseHook('PreToolUse', {
    command: 'sed -n 1,40p contracts/gate-matrix.md',
    session_id: 's-tool',
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/pre-tool-use.json'),
    response,
    'pre-tool-use'
  );
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

function testStopPassesThroughWhenCutepowerInactive() {
  const repoRoot = makeRepoFixture({ active: false });
  const response = parseHookJson(handleStop({
    cwd: repoRoot,
    session_id: 's-stop-pass',
  }));
  assert.equal(response.decision, 'allow');
  assert.equal(response.status, 'pass_through');
}

function testStopReturnsBlockedTerminalPackage() {
  const response = runAndParseHook('Stop', {
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
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/stop.json'),
    response,
    'stop'
  );
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
  testUserPromptSubmitPassesThroughHalloInNonCutepowerRepo();
  testUserPromptSubmitPassesThroughCommonPrompts();
  testUserPromptSubmitTakesOverExplicitCutepowerTask();
  testUserPromptSubmitTakesOverRepoLocalGovernanceTask();
  testUserPromptSubmitFailSafePassThroughOnException();
  testPreToolUsePassesThroughWhenCutepowerInactive();
  testPreToolUseAllowsAuthorizedReadOnlyAuditEvidenceRead();
  testPreToolUseRejectsUnauthorizedBusinessRead();
  testStopPassesThroughWhenCutepowerInactive();
  testStopReturnsBlockedTerminalPackage();
  testPreToolUseAllowsRepoLocalRegressionExecution();
  process.stdout.write('test-codex-hooks: ok\n');
}

run();
