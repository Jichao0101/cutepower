'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function testChineseAuditPromptRoutesThroughCli() {
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
  assert.equal(result.parsed.runtime_gate.capability, 'functional_audit_read_only');
}

function testHookIntegrationPromptStillRoutesToFixCapability() {
  const repoRoot = makeRepoFixture({ active: true });
  const result = runHookCli('UserPromptSubmit', {
    prompt: '修复 codex hook integration',
    cwd: repoRoot,
    session_id: 's-hook-fix',
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
  assert.equal(result.parsed.runtime_gate.route_resolution.route_id, 'explicit_hook_integration_fix');
  assert.equal(result.parsed.runtime_gate.capability, 'hook_integration_fix');
}

function testPreToolUseUnmappedEventPassesThroughCli() {
  const result = runHookCli('pre-tool-use', {
    command: 'perl -e 1',
    session_id: 's-unmapped',
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/pre-tool-use.json'),
    result.parsed,
    'pre-tool-use'
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.parsed.decision, 'pass_through');
  assert.equal(result.parsed.status, 'not_applicable');
  assert.equal(result.parsed.reason, 'unmapped_tool_event');
}

function testStopIncompleteClosurePassesThroughWithDiagnostics() {
  const result = runHookCli('stop', {
    session_id: 's-stop-incomplete',
    route_id: 'explicit_read_only_functional_audit',
    phase: 'evidence_collection',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
    artifacts: {
      terminal_phase: 'blocked_closed',
    },
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/stop.json'),
    result.parsed,
    'stop'
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.parsed.decision, 'pass_through');
  assert.equal(result.parsed.status, 'skipped');
  assert.equal(result.parsed.reason, 'run_is_not_closed');
  assert(result.parsed.diagnostics.missing_artifacts.includes('evidence_manifest'));
  assert(result.parsed.diagnostics.missing_artifacts.includes('review_decision'));
}

function testStopBlockedTerminalClosedReturnsCompletedPair() {
  const result = runHookCli('Stop', {
    session_id: 's-stop-blocked',
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
    result.parsed,
    'stop'
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.parsed.decision, 'allow');
  assert.equal(result.parsed.status, 'completed');
  assert.equal(result.parsed.reason, 'blocked_review_terminal_state_closed');
  assert.equal(result.parsed.completion_gate.terminal_outcome, 'blocked');
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
  testChineseAuditPromptRoutesThroughCli();
  testHookIntegrationPromptStillRoutesToFixCapability();
  testPreToolUseUnmappedEventPassesThroughCli();
  testStopIncompleteClosurePassesThroughWithDiagnostics();
  testStopBlockedTerminalClosedReturnsCompletedPair();
  testCliExceptionStillEmitsJsonAndNonZeroExit();
  process.stdout.write('test-codex-hooks: ok\n');
}

run();
