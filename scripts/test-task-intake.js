#!/usr/bin/env node

const path = require("path");

const { buildIntakePackage } = require("./task-intake");
const { evaluateRuntimeRequest, loadContracts } = require("./runtime-gates");

const docs = loadContracts();
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
  const bugFix = buildIntakePackage({
    task_goal: "Fix the startup regression in the repo and update the implementation.",
    cwd,
    authorizations: {
      repo_write: true
    }
  });
  assert(bugFix.intake.status === "accepted", "bug-fix request should be accepted by intake");
  assert(bugFix.route_resolution.route_id === "bug_fix_default", "bug-fix request should resolve the bug-fix route");
  assert(bugFix.skill_handoff.next_skill === "cute-scope-plan", "bug-fix request should hand off to cute-scope-plan first");
  assert(!bugFix.execution_policy.direct_execution_allowed, "accepted bug-fix should not allow direct fallback execution");

  const incident = buildIntakePackage({
    task_goal: "Investigate the crash logs and triage the incident before deciding whether code changes are needed.",
    cwd
  });
  assert(
    incident.route_resolution.route_id === "incident_investigation_default",
    "incident request should route to incident investigation first"
  );
  assert(
    incident.skill_handoff.next_skill === "cute-scope-plan",
    "incident request should hand off through scope plan before any repo change"
  );
  assert(!incident.execution_policy.direct_execution_allowed, "incident intake should not allow direct fallback execution");

  const audit = buildIntakePackage({
    task_goal: "Audit the current behavior and review it in read only mode. Do not modify code.",
    cwd
  });
  assert(audit.route_resolution.route_id === "audit_functional_read_only", "audit request should resolve the read-only audit route");
  assert(audit.task_profile.task_modifiers.includes("read_only"), "audit request should remain read-only");
  expectThrows(
    () =>
      evaluateRuntimeRequest(
        {
          request_type: "skill_invocation",
          route_id: audit.route_resolution.route_id,
          skill_id: "cute-functional-review",
          role_id: "functional-reviewer",
          state: "review",
          requested_actions: ["repo_write"]
        },
        docs
      ),
    "role functional-reviewer may not perform action repo_write"
  );

  const blockedBoard = buildIntakePackage({
    task_goal: "Fix the board crash on device and validate the logs on board.",
    cwd,
    authorizations: {
      repo_write: true
    }
  });
  assert(blockedBoard.runtime_gate.status === "blocked", "board task without board authorization should block");
  assert(
    blockedBoard.blocking_gaps.some((gap) => gap.gap_id === "board_execute_authorization"),
    "board task should report board authorization gap"
  );
  assert(!blockedBoard.execution_policy.direct_execution_allowed, "blocked board task should not silently fallback");

  const lowConfidenceEngineering = buildIntakePackage({
    task_goal: "Take a quick look at the failing repo flow and tell me what code path probably needs attention.",
    cwd
  });
  assert(lowConfidenceEngineering.engineering_signal.requested, "low-confidence engineering task should still trigger engineering intake");
  assert(
    lowConfidenceEngineering.runtime_gate.status === "clarification_required",
    "low-confidence engineering task should require clarification instead of declining"
  );
  assert(
    !lowConfidenceEngineering.execution_policy.direct_execution_allowed,
    "low-confidence engineering task should not silently fallback to direct execution"
  );
  assert(lowConfidenceEngineering.skill_handoff === null, "clarification-required intake must not hand off to execution skills");

  const runtimeDiscovery = buildIntakePackage({
    task_goal: "Check the Codex plugin runtime hook and marketplace entry under .codex and .agents before changing anything.",
    cwd
  });
  assert(runtimeDiscovery.runtime_discovery.requested, "runtime discovery request should be detected");
  assert(
    !runtimeDiscovery.blocking_gaps.some((gap) => gap.gap_id === "knowledge_read_authorization"),
    "runtime discovery should not be treated as knowledge-base authorization"
  );

  const knowledgeAuthGap = buildIntakePackage({
    task_goal: "Review the knowledge docs and project document before deciding what to change.",
    cwd,
    knowledge_base_root: "/mnt/d/Knowledge-Base",
    authorizations: {
      knowledge_read: false
    }
  });
  assert(
    knowledgeAuthGap.blocking_gaps.some((gap) => gap.gap_id === "knowledge_read_authorization"),
    "knowledge context request should report knowledge authorization gap"
  );

  const repoAuthGap = buildIntakePackage({
    task_goal: "Fix the repository regression and ship the code change.",
    cwd
  });
  assert(repoAuthGap.runtime_gate.status === "blocked", "repo change without repo authorization should block");
  assert(
    repoAuthGap.blocking_gaps.some((gap) => gap.gap_id === "repo_write_authorization"),
    "repo task should report repo write authorization gap"
  );
  assert(!repoAuthGap.execution_policy.direct_execution_allowed, "blocked repo task should not silently fallback");

  const explicitDecline = buildIntakePackage({
    task_goal: "Summarize this conversation style and help me write a short reply.",
    cwd
  });
  assert(explicitDecline.runtime_gate.status === "declined", "non-engineering request should decline cutepower intake");
  assert(explicitDecline.execution_policy.direct_execution_allowed, "only explicit decline should allow direct fallback execution");

  for (const protectedSkill of bugFix.execution_policy.protected_execution_skills) {
    assert(
      ["cute-repo-change", "cute-board-run", "cute-code-review", "cute-writeback"].includes(protectedSkill),
      `unexpected protected skill: ${protectedSkill}`
    );
  }

  console.log("cutepower task intake tests passed");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
