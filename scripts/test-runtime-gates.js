#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { buildSessionContextEnvelope, prepareActionRequest } = require("./host-runtime");
const { evaluateRuntimeRequest } = require("./runtime-gates");
const { getArtifactPath, writeArtifact, syncRunSession } = require("./run-artifacts");

const cwd = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (expectedMessage && !error.message.includes(expectedMessage)) {
      throw new Error(`expected error containing "${expectedMessage}", got "${error.message}"`);
    }
    return;
  }
  throw new Error("expected function to throw");
}

function makeBugFixEnvelope() {
  return buildSessionContextEnvelope({
    task_goal: "按 cutepower 执行，修复 repo 启动回归并更新代码。",
    cwd,
    authorizations: {
      repo_write: true
    }
  });
}

function makeReviewReadyEnvelope() {
  const envelope = makeBugFixEnvelope();
  const session = syncRunSession(path.join(envelope.intake_package.artifact_plan.artifact_dir, "session.json"));
  writeArtifact(session, "evidence_manifest", {
    evidence_items: [
      {
        kind: "test_result",
        path: "artifacts/test.log"
      }
    ]
  }, { phase: "review_active" });
  syncRunSession(session);
  return envelope;
}

function main() {
  const runtimeDiscoveryEnvelope = buildSessionContextEnvelope({
    task_goal: "按 cutepower 执行，先检查 runtime hook 和 contracts。",
    cwd,
    explicit_cutepower: true
  });
  runtimeDiscoveryEnvelope.host_runtime.action_guard.intake_status = null;
  runtimeDiscoveryEnvelope.host_runtime.action_guard.route_status = null;
  runtimeDiscoveryEnvelope.host_runtime.action_guard.runtime_gate_status = null;
  evaluateRuntimeRequest(
    prepareActionRequest(
      {
        request_type: "skill_invocation",
        skill_id: "using-cutepower",
        role_id: "workflow-orchestrator",
        requested_actions: ["runtime_discovery_read"]
      },
      runtimeDiscoveryEnvelope
    )
  );

  const readyEnvelope = makeBugFixEnvelope();
  const repoWriteRequest = prepareActionRequest(
    {
      request_type: "skill_invocation",
      route_id: readyEnvelope.intake_package.route_resolution.route_id,
      skill_id: "cute-repo-change",
      role_id: "repo-coder",
      state: "implementation",
      requested_actions: ["repo_write"]
    },
    readyEnvelope
  );
  evaluateRuntimeRequest(repoWriteRequest);

  const missingCapabilityRequest = {
    ...repoWriteRequest
  };
  delete missingCapabilityRequest.session_capability;
  expectThrows(() => evaluateRuntimeRequest(missingCapabilityRequest), "explicit runtime request requires session_capability");

  const taskProfilePath = getArtifactPath(readyEnvelope.intake_package.artifact_plan.artifact_dir, "task_profile");
  fs.rmSync(taskProfilePath, { force: true });
  expectThrows(() => evaluateRuntimeRequest(repoWriteRequest), "phase admission requires artifact task_profile");

  const reviewEnvelope = makeReviewReadyEnvelope();
  const reviewRequest = prepareActionRequest(
    {
      request_type: "review_decision",
      route_id: reviewEnvelope.intake_package.route_resolution.route_id,
      skill_id: "cute-code-review",
      role_id: "repo-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision"],
      evidence_keys: [
        "task_goal",
        "implementation_plan",
        "diff_summary",
        "verification_results",
        "verification_tier",
        "necessary_code_context"
      ],
      author_stage_id: "implementation",
      reviewer_stage_id: "review",
      author_instance_id: "author-1",
      reviewer_instance_id: "reviewer-1",
      inherit_full_author_context: false,
      inherit_full_author_reasoning: false
    },
    reviewEnvelope
  );
  evaluateRuntimeRequest(reviewRequest);

  const writebackWithoutReview = prepareActionRequest(
    {
      request_type: "writeback",
      route_id: reviewEnvelope.intake_package.route_resolution.route_id,
      scenario: "default",
      approval_gate: "review",
      writeback_level: "project_current_update",
      pass_statuses: ["repo_review_passed"],
      actor_role_id: "workflow-orchestrator",
      author_instance_id: "author-1",
      adjudication: {
        adjudicator_instance_id: "orchestrator-1"
      },
      completed_preconditions: [
        "writeback_state_reached",
        "route_writeback_requirements_satisfied",
        "review_pass_recorded",
        "independent_writeback_adjudication"
      ]
    },
    reviewEnvelope
  );
  expectThrows(() => evaluateRuntimeRequest(writebackWithoutReview), "phase review_active does not allow writeback");

  console.log("cutepower runtime gates tests passed");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
