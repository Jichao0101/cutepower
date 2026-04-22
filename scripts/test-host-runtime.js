#!/usr/bin/env node

const path = require("path");

const { buildSessionContextEnvelope, evaluateActionWithSession, prepareActionRequest } = require("./host-runtime");

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
  assert(explicitEnvelope.host_runtime.inject_session_context, "explicit cutepower request should inject session context");
  assert(
    explicitEnvelope.host_runtime.session_context.warning_lines.some((line) => line.includes("cutepower explicit mode")),
    "session context should include explicit mode warning"
  );
  assert(
    explicitEnvelope.host_runtime.session_context.required_preflight_outputs.includes("task_profile"),
    "session context should require task_profile before execution"
  );

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
