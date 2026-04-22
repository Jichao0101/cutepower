#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { buildSessionContextEnvelope, evaluateActionWithSession, prepareActionRequest } = require("./host-runtime");
const { getArtifactPath, readArtifact } = require("./run-artifacts");

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

function main() {
  const explicitEnvelope = buildSessionContextEnvelope({
    task_goal: "按 cutepower 执行，修复 repo 启动回归并更新代码。",
    cwd,
    authorizations: {
      repo_write: true
    }
  });

  assert(explicitEnvelope.host_runtime.explicit_mode, "explicit cutepower request should enable host runtime injection");
  assert(explicitEnvelope.host_runtime.session_context.session_id, "session context should expose session_id");
  assert(explicitEnvelope.host_runtime.session_context.artifact_dir, "session context should expose artifact_dir");
  assert(explicitEnvelope.host_runtime.session_capability.session_id === explicitEnvelope.intake_package.session_id, "session capability should bind to intake session");
  assert(explicitEnvelope.intake_package.phase === "gate_ready", "accepted repo change should reach gate_ready");
  assert(readArtifact(explicitEnvelope.intake_package.artifact_plan.artifact_dir, "task_profile"), "task_profile artifact should exist on disk");

  const preIntakeReadEnvelope = buildSessionContextEnvelope({
    task_goal: "按 cutepower 执行，先看一下 runtime hook。",
    cwd,
    explicit_cutepower: true
  });
  preIntakeReadEnvelope.host_runtime.action_guard.intake_status = null;
  preIntakeReadEnvelope.host_runtime.action_guard.route_status = null;
  preIntakeReadEnvelope.host_runtime.action_guard.runtime_gate_status = null;

  expectThrows(
    () =>
      evaluateActionWithSession(
        {
          request_type: "skill_invocation",
          skill_id: "using-cutepower",
          role_id: "workflow-orchestrator",
          requested_actions: ["business_context_read"]
        },
        preIntakeReadEnvelope
      ),
    "explicit cutepower mode requires intake/route/gate before action business_context_read"
  );

  const runtimeDiscoveryRequest = prepareActionRequest(
    {
      request_type: "skill_invocation",
      skill_id: "using-cutepower",
      role_id: "workflow-orchestrator",
      requested_actions: ["runtime_discovery_read"]
    },
    preIntakeReadEnvelope
  );
  assert(runtimeDiscoveryRequest.execution_mode === "explicit_cutepower", "prepared action should inherit explicit execution mode");

  evaluateActionWithSession(
    {
      request_type: "skill_invocation",
      skill_id: "using-cutepower",
      role_id: "workflow-orchestrator",
      requested_actions: ["runtime_discovery_read"]
    },
    preIntakeReadEnvelope
  );

  const readyBusinessRead = prepareActionRequest(
    {
      request_type: "skill_invocation",
      route_id: explicitEnvelope.intake_package.route_resolution.route_id,
      skill_id: "using-cutepower",
      role_id: "workflow-orchestrator",
      requested_actions: ["business_context_read"]
    },
    explicitEnvelope
  );
  assert(readyBusinessRead.session_capability, "ready request should receive a derived session capability");

  const taskProfilePath = getArtifactPath(explicitEnvelope.intake_package.artifact_plan.artifact_dir, "task_profile");
  fs.rmSync(taskProfilePath, { force: true });
  expectThrows(
    () => evaluateActionWithSession(readyBusinessRead, explicitEnvelope),
    "phase admission requires artifact task_profile"
  );

  const declineEnvelope = buildSessionContextEnvelope({
    task_goal: "按 cutepower 执行，帮我润色一句话。",
    cwd
  });
  assert(declineEnvelope.intake_package.runtime_gate.status === "declined", "non-engineering explicit request should decline");
  assert(declineEnvelope.host_runtime.action_guard.fallback_allowed, "declined explicit request should allow fallback");

  console.log("cutepower host runtime tests passed");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
