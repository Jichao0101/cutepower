'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeCutepowerIntent, buildRuntimeGate, evaluateIntake } = require('./task-intake');

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
  assert.equal(gate.capability, 'functional_audit_read_only');
}

function testChineseAuditPromptRoutesToReadOnlyCapability() {
  const prompts = [
    '严格按照cutepower分析代码是否满足设计文档',
    '按cutepower审查，不修改代码，只分析',
    '对照设计文档做符合性分析',
    '做只读审查',
    '做合规分析',
    '检查代码是否符合设计',
  ];
  for (const prompt of prompts) {
    const gate = buildRuntimeGate({
      prompt,
      evidence_collection_mode: 'read_only',
      authorization: {
        user_explicitly_authorized: true,
        project_paths_authorized: true,
        allowed_paths: ['contracts/', 'scripts/'],
      },
    });
    assert.equal(gate.status, 'ready');
    assert.equal(gate.route_resolution.route_id, 'explicit_read_only_functional_audit');
    assert.equal(gate.capability, 'functional_audit_read_only');
  }
}

function testLegacyRuntimeRepairPromptNoLongerRoutesAsPrimaryCapability() {
  const prompts = [
    '请按cutepower修复 legacy runtime 集成问题并恢复宿主兼容性',
    '修复 legacy runtime 与宿主兼容问题',
    '修复 codex runtime integration',
    'runtime integration defect',
  ];
  for (const prompt of prompts) {
    const gate = buildRuntimeGate({
      prompt,
      authorization: {
        user_explicitly_authorized: true,
        project_paths_authorized: true,
        allowed_paths: ['contracts/', 'scripts/', 'docs/'],
      },
    });
    assert.equal(gate.status, 'declined');
    assert.equal(gate.route_resolution.route_id, 'declined_general_execution');
    assert.equal(gate.capability, null);
  }
}

function testGeneralPromptDoesNotRequestCutepowerGovernance() {
  const intent = analyzeCutepowerIntent({
    prompt: 'Explain this repo',
  });
  assert.equal(intent.should_consider_cutepower, false);
}

function testEvaluateIntakePersistsRequiredPreflightArtifacts() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-intake-'));
  fs.mkdirSync(path.join(repoRoot, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.codex-plugin', 'plugin.json'), '{}\n', 'utf8');
  const verdict = evaluateIntake({
    session_id: 's-intake',
    cwd: repoRoot,
    prompt: '严格按照cutepower分析代码是否满足设计文档',
    evidence_collection_mode: 'read_only',
    authorization: {
      user_explicitly_authorized: true,
      project_paths_authorized: true,
      allowed_paths: ['contracts/', 'scripts/', 'docs/'],
    },
  });
  assert.equal(verdict.gate_result, 'ready');
  assert.equal(fs.existsSync(path.join(repoRoot, '.cutepower', 'run', 's-intake', 'task_profile.json')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, '.cutepower', 'run', 's-intake', 'route_resolution.json')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, '.cutepower', 'run', 's-intake', 'runtime_gate.json')), true);
}

function run() {
  testExplicitReadOnlyAuditGetsReadyGateWithAuthorization();
  testChineseAuditPromptRoutesToReadOnlyCapability();
  testLegacyRuntimeRepairPromptNoLongerRoutesAsPrimaryCapability();
  testGeneralPromptDoesNotRequestCutepowerGovernance();
  testEvaluateIntakePersistsRequiredPreflightArtifacts();
  process.stdout.write('test-task-intake: ok\n');
}

run();
