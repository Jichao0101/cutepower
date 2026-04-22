#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadRunSession, writeArtifact, syncRunSession } = require("./run-artifacts");

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

function recordReviewClosure(state, includeWriteback) {
  const session = syncRunSession(path.join(state.action_guard.artifact_dir, "session.json"));
  writeArtifact(session, "evidence_manifest", {
    evidence_items: [
      {
        kind: "verification_result",
        path: "artifacts/test.log"
      }
    ]
  }, { phase: "review_active" });
  writeArtifact(session, "review_decision", {
    review_type: "functional_review",
    outcome: "pass",
    reviewer_role_id: "functional-reviewer",
    reviewer_instance_id: "functional-reviewer-1",
    evidence_keys: [
      "requirements_package",
      "acceptance_items",
      "interface_contracts",
      "evidence_package"
    ]
  }, { phase: "review_active" });

  if (includeWriteback) {
    writeArtifact(session, "writeback_receipt", {
      writeback_level: "project_current_update",
      approval_gate: "review",
      actor_role_id: "workflow-orchestrator",
      pass_statuses: ["functional_review_passed"]
    }, { phase: "writeback_ready" });
  }

  syncRunSession(session);
}

function main() {
  resetState();

  const promptHook = runHook("user-prompt-submit", {
    prompt: "按 cutepower 执行，只读 audit 当前行为并做 functional review。"
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

  const unmapped = runHook("pre-tool-use", {
    tool_name: "UnknownTool",
    payload: {
      x: 1
    }
  });
  assert(unmapped.status !== 0, "unmapped event should be denied in explicit mode");
  assert(
    readState().denied_events.some((event) => event.error.includes("unmapped tool event denied")),
    "unmapped denial should be recorded"
  );

  const readyState = readState();
  readyState.action_guard.intake_status = "accepted";
  readyState.action_guard.route_status = "resolved";
  readyState.action_guard.runtime_gate_status = "ready";
  fs.writeFileSync(hookStatePath, `${JSON.stringify(readyState, null, 2)}\n`, "utf8");

  const stopWithoutReview = runHook("stop", {});
  assert(stopWithoutReview.status !== 0, "stop should fail when closure artifacts are missing");

  recordReviewClosure(readState(), false);
  const stopWithoutWriteback = runHook("stop", {});
  assert(stopWithoutWriteback.status !== 0, "stop should fail when writeback receipt is missing");

  recordReviewClosure(readState(), true);
  const stopComplete = runHook("stop", {});
  assert(stopComplete.status === 0, "stop should succeed after closed-loop artifacts are present");

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
