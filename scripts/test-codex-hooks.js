'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { writeArtifact } = require('./run-artifacts');

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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runHookCli(hookName, payload) {
  const inputPath = path.join(
    os.tmpdir(),
    `cutepower-hook-input-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  fs.writeFileSync(inputPath, `${JSON.stringify(payload)}\n`, 'utf8');
  try {
    const command = [
      'stdout_file=$(mktemp)',
      'stderr_file=$(mktemp)',
      `node ${shellQuote(path.join(__dirname, 'codex-hooks.js'))} ${shellQuote(hookName)} < ${shellQuote(inputPath)} >"$stdout_file" 2>"$stderr_file"`,
      'status=$?',
      'cat "$stdout_file"',
      'cat "$stderr_file" >&2',
      'rm -f "$stdout_file" "$stderr_file"',
      'exit $status',
    ].join('; ');
    const result = spawnSync(
      '/bin/bash',
      ['-lc', command],
      { encoding: 'utf8' }
    );
    const stdout = result.stdout.trim();
    assert(stdout, `${hookName} did not emit stdout`);
    assert.equal(stdout.split('\n').length, 1, `${hookName} emitted more than one stdout line`);
    return {
      status: result.status,
      signal: result.signal,
      stdout,
      stderr: result.stderr.trim(),
      parsed: JSON.parse(stdout),
    };
  } finally {
    fs.rmSync(inputPath, { force: true });
  }
}

function seedPreflightArtifacts(repoRoot, sessionId, routeId, capability, gateStatus = 'ready') {
  const artifactRoot = path.join(repoRoot, '.cutepower');
  writeArtifact(artifactRoot, sessionId, 'task_profile', { primary_type: capability });
  writeArtifact(artifactRoot, sessionId, 'route_resolution', { route_id: routeId, phase: 'evidence_collection' });
  writeArtifact(artifactRoot, sessionId, 'runtime_gate', {
    session_id: sessionId,
    status: gateStatus,
    route_resolution: { route_id: routeId, phase: 'evidence_collection' },
    phase: 'evidence_collection',
    capability,
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
    evidence_collection_mode: 'read_only',
    required_preflight_outputs: ['task_profile', 'route_resolution', 'runtime_gate'],
  });
}

function testUserPromptSubmitReadyIssuesCapability() {
  const repoRoot = makeRepoFixture({ active: true });
  const result = runHookCli('user-prompt-submit', {
    prompt: '严格按照cutepower分析代码是否满足设计文档',
    cwd: repoRoot,
    session_id: 's-cn-audit',
    evidence_collection_mode: 'read_only',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/user-prompt-submit.json'),
    result.parsed,
    'user-prompt-submit'
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.parsed.decision, 'allow');
  assert.equal(result.parsed.status, 'ready');
  assert.equal(result.parsed.runtime_gate.route_resolution.route_id, 'explicit_read_only_functional_audit');
  assert.equal(result.parsed.session_capability.session_id, 's-cn-audit');
}

function testUserPromptSubmitFailureDoesNotIssueCapabilityAndBlocksLaterToolUse() {
  const repoRoot = makeRepoFixture({ active: true });
  const submit = runHookCli('UserPromptSubmit', {
    prompt: '修复 codex hook integration',
    cwd: repoRoot,
    session_id: 's-hook-fail',
    authorization: {
      user_explicitly_authorized: false,
      project_paths_authorized: false,
    },
  });
  assert.equal(submit.status, 0);
  assert.equal(submit.parsed.decision, 'deny');
  assert.equal(submit.parsed.status, 'blocked');
  assert.equal(submit.parsed.session_capability, null);

  const preTool = runHookCli('PreToolUse', {
    cwd: repoRoot,
    session_id: 's-hook-fail',
    command: 'bash -lc whoami',
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/pre-tool-use.json'),
    preTool.parsed,
    'pre-tool-use'
  );
  assert.equal(preTool.status, 0);
  assert.equal(preTool.parsed.decision, 'deny');
  assert.equal(preTool.parsed.status, 'blocked');
  assert.equal(preTool.parsed.reason, 'current_session_missing_valid_capability');
}

function testPreToolUseDeniesHighRiskActionWithoutRuntimeGateArtifact() {
  const repoRoot = makeRepoFixture({ active: true });
  writeArtifact(path.join(repoRoot, '.cutepower'), 's-no-gate', 'task_profile', { primary_type: 'functional_audit' });
  writeArtifact(path.join(repoRoot, '.cutepower'), 's-no-gate', 'route_resolution', { route_id: 'explicit_read_only_functional_audit' });
  const result = runHookCli('pre-tool-use', {
    cwd: repoRoot,
    session_id: 's-no-gate',
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
    session_capability: {
      session_id: 's-no-gate',
      route_id: 'explicit_read_only_functional_audit',
      phase: 'evidence_collection',
      capability: 'functional_audit_read_only',
      allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
      required_artifacts: ['task_profile', 'route_resolution', 'runtime_gate'],
    },
    command: 'sed -n 1,20p contracts/gate-matrix.yaml',
  });
  assert.equal(result.status, 0);
  assert.equal(result.parsed.decision, 'deny');
  assert.equal(result.parsed.reason, 'required_runtime_artifacts_missing');
  assert(result.parsed.guard_result.missing_artifacts.includes('runtime_gate'));
}

function testPreToolUseDeniesUnmappedHighRiskExec() {
  const repoRoot = makeRepoFixture({ active: true });
  seedPreflightArtifacts(
    repoRoot,
    's-unmapped',
    'explicit_read_only_functional_audit',
    'functional_audit_read_only'
  );
  const result = runHookCli('pre-tool-use', {
    cwd: repoRoot,
    session_id: 's-unmapped',
    session_capability: {
      session_id: 's-unmapped',
      route_id: 'explicit_read_only_functional_audit',
      phase: 'evidence_collection',
      capability: 'functional_audit_read_only',
      allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
      required_artifacts: ['task_profile', 'route_resolution', 'runtime_gate'],
    },
    command: 'perl -e 1',
  });
  assert.equal(result.status, 0);
  assert.equal(result.parsed.decision, 'deny');
  assert.equal(result.parsed.reason, 'unmapped_high_risk_tool_event_denied');
}

function testStopAfterFailureCannotPretendCompleted() {
  const repoRoot = makeRepoFixture({ active: true });
  runHookCli('UserPromptSubmit', {
    prompt: '修复 codex hook integration',
    cwd: repoRoot,
    session_id: 's-stop-fail',
    authorization: {
      user_explicitly_authorized: false,
      project_paths_authorized: false,
    },
  });
  const result = runHookCli('stop', {
    cwd: repoRoot,
    session_id: 's-stop-fail',
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/stop.json'),
    result.parsed,
    'stop'
  );
  assert.equal(result.status, 0);
  assert.notEqual(result.parsed.status, 'completed');
  assert(['skipped', 'blocked', 'error', 'not_applicable'].includes(result.parsed.status));
}

function testStopCompletedOnlyWithLegalClosure() {
  const repoRoot = makeRepoFixture({ active: true });
  seedPreflightArtifacts(
    repoRoot,
    's-stop-ok',
    'explicit_read_only_functional_audit',
    'functional_audit_read_only'
  );
  writeArtifact(path.join(repoRoot, '.cutepower'), 's-stop-ok', 'evidence_manifest', { status: 'complete' });
  writeArtifact(path.join(repoRoot, '.cutepower'), 's-stop-ok', 'review_decision', { decision: 'approved' });
  writeArtifact(path.join(repoRoot, '.cutepower'), 's-stop-ok', 'writeback_declined', { status: 'declined' });
  writeArtifact(path.join(repoRoot, '.cutepower'), 's-stop-ok', 'terminal_phase', 'closed');
  const result = runHookCli('Stop', {
    cwd: repoRoot,
    session_id: 's-stop-ok',
  });
  assert.equal(result.status, 0);
  assert.equal(result.parsed.decision, 'allow');
  assert.equal(result.parsed.status, 'completed');
}

function testCliExceptionStillEmitsJsonAndNonZeroExit() {
  const result = runHookCli('user-prompt-submit', {
    prompt: '严格按照cutepower分析代码是否满足设计文档',
    cwd: {},
    session_id: 's-error',
    evidence_collection_mode: 'read_only',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      allowed_paths: ['contracts/', 'scripts/'],
    },
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/user-prompt-submit.json'),
    result.parsed,
    'user-prompt-submit'
  );
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes('[codex-hooks] UserPromptSubmit error'));
  assert.equal(result.parsed.decision, 'error');
  assert.equal(result.parsed.status, 'error');
  assert.equal(result.parsed.reason, 'hook_handler_exception');
}

function run() {
  testUserPromptSubmitReadyIssuesCapability();
  testUserPromptSubmitFailureDoesNotIssueCapabilityAndBlocksLaterToolUse();
  testPreToolUseDeniesHighRiskActionWithoutRuntimeGateArtifact();
  testPreToolUseDeniesUnmappedHighRiskExec();
  testStopAfterFailureCannotPretendCompleted();
  testStopCompletedOnlyWithLegalClosure();
  testCliExceptionStillEmitsJsonAndNonZeroExit();
  process.stdout.write('test-codex-hooks: ok\n');
}

run();
