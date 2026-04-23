'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeArtifact } = require('./run-artifacts');
const {
  buildBlockedTerminalArtifacts,
  evaluateStopGate,
  extractToolMetadata,
  evaluateToolUseVerdict,
  gateToolAction,
} = require('./runtime-gates');

function makeHostRuntime(overrides = {}) {
  return {
    session_id: 's-runtime',
    workspace_root: overrides.workspace_root || null,
    route_id: 'audit_functional_read_only',
    phase: 'analysis',
    capability: 'functional_audit_read_only',
    evidence_collection_mode: 'read_only',
    allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
    allowed_paths: ['contracts/', 'scripts/'],
    required_preflight_outputs: ['task_profile', 'route_resolution', 'dispatch_manifest', 'runtime_gate'],
    managed_by_cutepower: true,
    runtime_gate_status: 'ready',
    session_capability: {
      session_id: 's-runtime',
      route_id: 'audit_functional_read_only',
      phase: 'analysis',
      capability: 'functional_audit_read_only',
      allowed_actions: ['runtime_discovery_read', 'authorized_business_context_read'],
      required_artifacts: ['task_profile', 'route_resolution', 'dispatch_manifest', 'runtime_gate'],
    },
    ...overrides,
  };
}

function seedPreflightArtifacts(workspaceRoot, sessionId, runtimeGateStatus = 'ready') {
  const artifactRoot = path.join(workspaceRoot, '.cutepower');
  writeArtifact(artifactRoot, sessionId, 'task_profile', { primary_type: 'audit' });
  writeArtifact(artifactRoot, sessionId, 'route_resolution', { route_id: 'audit_functional_read_only' });
  writeArtifact(artifactRoot, sessionId, 'dispatch_manifest', {
    session_id: sessionId,
    route_id: 'audit_functional_read_only',
    current_phase: 'analysis',
    current_skill: 'using-cutepower',
    next_skill: 'cute-scope-plan',
  });
  writeArtifact(artifactRoot, sessionId, 'runtime_gate', {
    status: runtimeGateStatus,
    route_resolution: { route_id: 'audit_functional_read_only' },
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
  writeArtifact(path.join(workspaceRoot, '.cutepower'), 's-runtime', 'task_profile', { primary_type: 'audit' });
  writeArtifact(path.join(workspaceRoot, '.cutepower'), 's-runtime', 'route_resolution', { route_id: 'audit_functional_read_only' });
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
    routeId: 'audit_functional_read_only',
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

function makeFunctionalReviewArtifacts(overrides = {}) {
  return {
    requirements_package: {
      requirements: [
        {
          requirement_id: 'REQ-1',
          requirement_text: 'Feature must emit structured output',
          requirement_type: 'functional',
          severity: 'high',
          source_path: 'docs/spec.md',
        },
      ],
    },
    acceptance_items: {
      acceptance_items: [
        {
          acceptance_item_id: 'ACC-1',
          mapped_requirement_ids: ['REQ-1'],
          pass_criteria: 'Output contains stable schema',
          expected_evidence_types: ['code_read'],
        },
      ],
    },
    evidence_plan: {
      allowed_paths: ['scripts/', 'contracts/'],
      planned_evidence_sources: ['scripts/runtime-gates.js'],
    },
    relevant_context: {
      allowed_paths: ['scripts/', 'contracts/'],
      core_paths: ['scripts/runtime-gates.js'],
    },
    evidence_manifest: {
      status: 'complete',
      evidence: [
        {
          evidence_id: 'EVD-1',
          path: 'scripts/runtime-gates.js',
          acceptance_item_ids: ['ACC-1'],
        },
      ],
    },
    evidence_gaps: {
      gaps: [],
    },
    review_decision: {
      decision: 'approved',
      blocked_by: [],
      allows_completed: true,
      evidence_sufficiency_summary: 'sufficient',
    },
    compliance_matrix: {
      rows: [
        {
          requirement_id: 'REQ-1',
          acceptance_item_ids: ['ACC-1'],
          evidence_ids: ['EVD-1'],
          status: 'pass',
          notes: 'Covered',
        },
      ],
    },
    terminal_phase: 'closed',
    writeback_declined: { status: 'declined' },
    ...overrides,
  };
}

function testFunctionalReviewCannotCompleteWithoutRequirementsPackage() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-stop-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const artifacts = makeFunctionalReviewArtifacts();
  delete artifacts.requirements_package;
  const result = evaluateStopGate({
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
    artifacts,
  });
  assert.equal(result.gate_result, 'not_applicable');
  assert(result.missing_artifacts.includes('requirements_package'));
}

function testFunctionalReviewCannotCompleteWithoutAcceptanceItems() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-stop-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const artifacts = makeFunctionalReviewArtifacts();
  delete artifacts.acceptance_items;
  const result = evaluateStopGate({
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
    artifacts,
  });
  assert.equal(result.gate_result, 'not_applicable');
  assert(result.missing_artifacts.includes('acceptance_items'));
}

function testFunctionalReviewCannotCompleteWithoutEvidenceManifest() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-stop-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const artifacts = makeFunctionalReviewArtifacts();
  delete artifacts.evidence_manifest;
  const result = evaluateStopGate({
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
    artifacts,
  });
  assert.equal(result.gate_result, 'not_applicable');
  assert(result.missing_artifacts.includes('evidence_manifest'));
}

function testFunctionalReviewGapPreventsApprovedCompletion() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-stop-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateStopGate({
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
    artifacts: makeFunctionalReviewArtifacts({
      evidence_manifest: {
        status: 'complete',
        evidence: [],
      },
      evidence_gaps: {
        gaps: [
          {
            requirement_id: 'REQ-1',
            acceptance_item_id: 'ACC-1',
            reason: 'acceptance_item_missing_evidence_coverage',
            blocker: true,
          },
        ],
      },
      compliance_matrix: {
        rows: [
          {
            requirement_id: 'REQ-1',
            acceptance_item_ids: ['ACC-1'],
            evidence_ids: [],
            status: 'gap',
            notes: 'No evidence',
          },
        ],
      },
      review_decision: {
        decision: 'approved',
        blocked_by: [],
        allows_completed: true,
      },
    }),
  });
  assert.equal(result.gate_result, 'not_applicable');
  assert.equal(result.diagnostics.review_validation.coverage_summary.blocker_gaps, 1);
  assert.equal(result.diagnostics.review_validation.computed_evidence_gaps[0].reason, 'acceptance_item_missing_evidence_coverage');
}

function testEvidenceWithoutAcceptanceMappingDoesNotCountAsPass() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-stop-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateStopGate({
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
    artifacts: makeFunctionalReviewArtifacts({
      evidence_manifest: {
        status: 'blocked',
        evidence: [
          {
            evidence_id: 'EVD-ORPHAN',
            path: 'scripts/runtime-gates.js',
            acceptance_item_ids: [],
          },
        ],
      },
      evidence_gaps: {
        gaps: [
          {
            requirement_id: 'REQ-1',
            acceptance_item_id: 'ACC-1',
            reason: 'acceptance_item_missing_evidence_coverage',
            blocker: true,
          },
        ],
      },
      compliance_matrix: {
        rows: [
          {
            requirement_id: 'REQ-1',
            acceptance_item_ids: ['ACC-1'],
            evidence_ids: [],
            status: 'gap',
            notes: 'Orphan evidence does not count',
          },
        ],
      },
      review_decision: {
        decision: 'blocked',
        blocked_by: ['acceptance_item_missing_evidence_coverage'],
        allows_completed: false,
      },
      terminal_phase: 'blocked_closed',
    }),
  });
  assert.equal(result.gate_result, 'ready');
  assert.equal(result.completion_gate.terminal_outcome, 'blocked');
  assert.equal(result.diagnostics.review_validation.orphan_evidence[0].evidence_id, 'EVD-ORPHAN');
}

function testMetadataRiskInferenceDeniesMutatingAction() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateToolUseVerdict({
    payload: {
      tool_metadata: {
        tool_name: 'Edit',
        operation_class: 'write',
        intent: 'write',
        is_mutating: true,
        target_paths: ['scripts/runtime-gates.js'],
      },
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
  });
  assert.equal(result.gate_result, 'blocked');
  assert.equal(result.reason, 'unmapped_high_risk_tool_event_denied');
  assert.equal(result.diagnostics.inferred_action.inference_source, 'metadata');
}

function testGovernedSkillOrderMismatchBlocked() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateToolUseVerdict({
    payload: {
      command: 'sed -n 1,10p contracts/gate-matrix.yaml',
      skill_name: 'cute-code-review',
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
  });
  assert.equal(result.gate_result, 'blocked');
  assert.equal(result.reason, 'governed_skill_out_of_route_order');
}

function testMetadataRiskInferenceAllowsLowRiskRead() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateToolUseVerdict({
    payload: {
      tool_metadata: {
        tool_name: 'Read',
        operation_class: 'read',
        intent: 'read',
        is_mutating: false,
        target_paths: ['contracts/gate-matrix.yaml'],
      },
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
  });
  assert.equal(result.gate_result, 'ready');
  assert.equal(result.reason, 'authorized_business_context_read_allowed_for_route');
  assert.equal(result.diagnostics.inferred_action.inference_source, 'metadata');
}

function testFallbackCommandRiskInferenceStillDeniesHighRiskExec() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateToolUseVerdict({
    payload: {
      command: 'bash -lc whoami',
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
  });
  assert.equal(result.gate_result, 'blocked');
  assert.equal(result.diagnostics.inferred_action.inference_source, 'command_fallback');
}

function testFallbackCommandReadDoesNotFalseDeny() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-runtime-'));
  seedPreflightArtifacts(workspaceRoot, 's-runtime');
  const result = evaluateToolUseVerdict({
    payload: {
      command: 'sed -n 1,20p contracts/gate-matrix.yaml',
    },
    hostRuntime: makeHostRuntime({
      workspace_root: workspaceRoot,
    }),
  });
  assert.equal(result.gate_result, 'ready');
  assert.equal(result.diagnostics.inferred_action.inference_source, 'command_fallback');
}

function run() {
  testAuthorizedBusinessReadAllowedInEvidenceCollection();
  testHighRiskToolDeniedWithoutCapability();
  testMissingRuntimeGateArtifactBlocksToolUse();
  testUnmappedHighRiskToolDenied();
  testBlockedReviewCanClose();
  testStopCannotCompleteWithoutReviewDecision();
  testFunctionalReviewCannotCompleteWithoutRequirementsPackage();
  testFunctionalReviewCannotCompleteWithoutAcceptanceItems();
  testFunctionalReviewCannotCompleteWithoutEvidenceManifest();
  testFunctionalReviewGapPreventsApprovedCompletion();
  testEvidenceWithoutAcceptanceMappingDoesNotCountAsPass();
  testGovernedSkillOrderMismatchBlocked();
  testMetadataRiskInferenceDeniesMutatingAction();
  testMetadataRiskInferenceAllowsLowRiskRead();
  testFallbackCommandRiskInferenceStillDeniesHighRiskExec();
  testFallbackCommandReadDoesNotFalseDeny();
  process.stdout.write('test-runtime-gates: ok\n');
}

run();
