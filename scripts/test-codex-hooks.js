'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runHookHandler } = require('./codex-hooks');

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

function captureHookJson(hookName, payload) {
  let stdout = '';
  let stderr = '';
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr += String(chunk);
    return true;
  };
  try {
    const returned = runHookHandler(hookName, payload);
    const trimmed = stdout.trim();
    assert(trimmed, `${hookName} did not emit stdout`);
    assert.equal(trimmed.split('\n').length, 1, `${hookName} emitted more than one stdout line`);
    return {
      returned,
      stdout: trimmed,
      stderr: stderr.trim(),
      parsed: JSON.parse(trimmed),
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

function testUserPromptSubmitPassesThroughNonTakeoverPromptAsJson() {
  const repoRoot = makeRepoFixture({ active: false });
  const result = captureHookJson('UserPromptSubmit', {
    prompt: 'hello',
    cwd: repoRoot,
    session_id: 's-non-takeover',
  });
  validateRequiredKeys(
    readSchema('schemas/hook-responses/user-prompt-submit.json'),
    result.parsed,
    'user-prompt-submit'
  );
  assert.equal(result.parsed.decision, 'pass_through');
  assert.equal(result.parsed.status, 'not_applicable');
  assert.equal(result.parsed.reason, 'non_governance_prompt_passthrough');
  assert.equal(result.parsed.entry_action, 'pass_through');
}

function testUserPromptSubmitReturnsStructuredJsonForChineseAuditPrompt() {
  const repoRoot = makeRepoFixture({ active: true });
  const result = captureHookJson('UserPromptSubmit', {
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
  assert.equal(result.parsed.decision, 'allow');
  assert.equal(result.parsed.status, 'ready');
  assert.equal(result.parsed.runtime_gate.capability, 'functional_audit_read_only');
}

function testPreToolUseUnmappedEventPassesThroughAsJson() {
  const result = captureHookJson('PreToolUse', {
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
  assert.equal(result.parsed.decision, 'pass_through');
  assert.equal(result.parsed.status, 'not_applicable');
  assert.equal(result.parsed.reason, 'unmapped_tool_event');
  assert.equal(result.parsed.action, 'pass_through');
}

function testStopReturnsStructuredJson() {
  const result = captureHookJson('Stop', {
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
    result.parsed,
    'stop'
  );
  assert.equal(result.parsed.decision, 'allow');
  assert.equal(result.parsed.reason, 'blocked_review_terminal_state_closed');
  assert.equal(result.parsed.completion_gate.reason, 'blocked_review_terminal_state_closed');
}

function run() {
  testUserPromptSubmitPassesThroughNonTakeoverPromptAsJson();
  testUserPromptSubmitReturnsStructuredJsonForChineseAuditPrompt();
  testPreToolUseUnmappedEventPassesThroughAsJson();
  testStopReturnsStructuredJson();
  process.stdout.write('test-codex-hooks: ok\n');
}

run();
