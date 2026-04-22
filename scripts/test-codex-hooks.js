#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const hookStatePath = path.join(
  os.tmpdir(),
  `cutepower-hook-state-${Buffer.from(repoRoot).toString("hex").slice(0, 24)}`,
  "cutepower-state.json"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runHook(mode, payload) {
  return spawnSync("node", [path.join(repoRoot, "scripts", "codex-hooks.js"), mode], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOOK_PAYLOAD: JSON.stringify(payload)
    }
  });
}

function resetState() {
  fs.rmSync(path.dirname(hookStatePath), { recursive: true, force: true });
}

function readState() {
  return JSON.parse(fs.readFileSync(hookStatePath, "utf8"));
}

function main() {
  resetState();

  const promptHook = runHook("user-prompt-submit", {
    prompt: "按 cutepower 执行，修复 repo 启动回归并更新代码。"
  });
  assert(promptHook.status === 0, "UserPromptSubmit hook should succeed");

  const stateAfterPrompt = readState();
  assert(stateAfterPrompt.explicit_mode, "prompt hook should persist explicit mode state");
  assert(stateAfterPrompt.session_context.required_preflight_outputs.includes("task_profile"), "hook state should include required preflight outputs");

  stateAfterPrompt.action_guard.intake_status = null;
  stateAfterPrompt.action_guard.route_status = null;
  stateAfterPrompt.action_guard.runtime_gate_status = null;
  fs.writeFileSync(hookStatePath, `${JSON.stringify(stateAfterPrompt, null, 2)}\n`, "utf8");

  const blockedRead = runHook("pre-tool-use", {
    tool_name: "Read",
    path: "/mnt/d/cutepower/src/main.cpp"
  });
  assert(blockedRead.status !== 0, "PreToolUse should block business read before ready");
  assert(
    readState().denied_events.some((event) => event.error.includes("explicit cutepower mode requires intake/route/gate before action business_context_read")),
    "blocked business read should report intake lock"
  );

  const runtimeRead = runHook("pre-tool-use", {
    tool_name: "Read",
    path: "/mnt/d/cutepower/.codex/hooks.json"
  });
  assert(runtimeRead.status === 0, "PreToolUse should allow runtime discovery before ready");

  const readyState = readState();
  readyState.action_guard.intake_status = "accepted";
  readyState.action_guard.route_status = "resolved";
  readyState.action_guard.runtime_gate_status = "ready";
  fs.writeFileSync(hookStatePath, `${JSON.stringify(readyState, null, 2)}\n`, "utf8");

  const selfReview = runHook("pre-tool-use", {
    cutepower_request: {
      request_type: "review_decision",
      route_id: "bug_fix_default",
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
      author_stage_id: "review",
      reviewer_stage_id: "review",
      author_instance_id: "author-1",
      reviewer_instance_id: "author-1"
    }
  });
  assert(selfReview.status !== 0, "PreToolUse should block author self-review");
  assert(
    readState().denied_events.some((event) => event.error.includes("review requires a separate reviewer stage or instance")),
    "self-review should fail independent review check"
  );

  const writeback = runHook("pre-tool-use", {
    cutepower_request: {
      request_type: "writeback",
      route_id: "bug_fix_default",
      scenario: "default",
      approval_gate: "review",
      writeback_level: "project_current_update",
      pass_statuses: [],
      actor_role_id: "workflow-orchestrator",
      author_instance_id: "author-1",
      adjudication: {
        adjudicator_instance_id: "orchestrator-1"
      },
      completed_preconditions: [
        "writeback_state_reached",
        "route_writeback_requirements_satisfied",
        "independent_writeback_adjudication"
      ]
    }
  });
  assert(writeback.status !== 0, "PreToolUse should block writeback without required passes");
  assert(
    readState().denied_events.some((event) => event.error.includes("missing required pass status repo_review_passed")),
    "writeback failure should report missing pass status"
  );

  const stopHook = runHook("stop", {});
  assert(stopHook.status === 0, "Stop hook should succeed");
  const finalState = readState();
  assert(finalState.denied_events.length >= 3, "hook state should record denied events");

  console.log("cutepower codex hooks tests passed");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
