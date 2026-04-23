#!/usr/bin/env node

const assert = require("assert");
const path = require("path");
const { buildTaskProfile } = require("./task-profile");

const cwd = path.resolve(__dirname, "..");

function main() {
  const bugFix = buildTaskProfile({
    task_goal: "Fix the failing startup regression in the launcher and update the repo code.",
    cwd
  });
  assert.equal(bugFix.primary_type, "bug_fix", "bug-fix task should infer bug_fix");
  assert.equal(bugFix.route_id, "bug_fix_default", "bug-fix task should route to bug_fix_default");
  assert.equal(bugFix.task_modifiers.includes("review_required"), true, "bug-fix task should require review");
  assert.equal(bugFix.inferred_context.repo_root, cwd, "bug-fix task should infer repo_root from cwd");
  assert.deepEqual(
    bugFix.resolved_skill_chain,
    ["cute-scope-plan", "cute-repo-change", "cute-code-review", "cute-writeback"],
    "bug-fix task should resolve the governed skill chain"
  );

  const reviewOnly = buildTaskProfile({
    task_goal: "Review the current behavior and assess whether the flow is correct. Do not modify code.",
    cwd
  });
  assert.equal(reviewOnly.primary_type, "audit", "review task should infer audit");
  assert.equal(reviewOnly.route_id, "audit_functional_read_only", "review task should resolve to read-only audit route");
  assert.equal(reviewOnly.task_modifiers.includes("read_only"), true, "review task should carry read_only modifier");
  assert.equal(reviewOnly.task_modifiers.includes("code_change_allowed"), false, "review task must not enable repo writes");
  assert.equal(reviewOnly.requires_dispatch, true, "review task should require the dispatcher");

  const boardFix = buildTaskProfile({
    task_goal: "修复板端启动问题，并在真机上板验证日志和信号。",
    cwd
  });
  assert.equal(boardFix.primary_type, "bug_fix", "board fix should still infer bug_fix");
  assert.equal(boardFix.task_modifiers.includes("board_execution_required"), true, "board semantics should infer board execution");
  assert.equal(boardFix.route_id, "bug_fix_board_validation", "board fix should resolve to board validation route");
  assert.equal(boardFix.missing_context.includes("board_target"), true, "board route should report missing board_target when absent");

  const ambiguous = buildTaskProfile({
    task_goal: "Take a look at this and tell me what should happen next.",
    cwd
  });
  assert.equal(ambiguous.primary_type, null, "ambiguous task should not force a primary_type");
  assert.equal(ambiguous.route_id, null, "ambiguous task should not resolve a route");
  assert.equal(ambiguous.requires_clarification, true, "ambiguous task should require clarification");

  console.log("cutepower task profile tests passed");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
