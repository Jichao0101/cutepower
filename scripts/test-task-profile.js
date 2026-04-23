#!/usr/bin/env node

const path = require("path");
const { buildTaskProfile } = require("./task-profile");

const cwd = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const bugFix = buildTaskProfile({
    task_goal: "Fix the failing startup regression in the launcher and update the repo code.",
    cwd
  });
  assert(bugFix.primary_type === "bug_fix", "bug-fix task should infer bug_fix");
  assert(bugFix.route_id === "bug_fix_default", "bug-fix task should route to bug_fix_default");
  assert(bugFix.task_modifiers.includes("review_required"), "bug-fix task should require review");
  assert(bugFix.inferred_context.repo_root === cwd, "bug-fix task should infer repo_root from cwd");

  const reviewOnly = buildTaskProfile({
    task_goal: "Review the current behavior and assess whether the flow is correct. Do not modify code.",
    cwd
  });
  assert(reviewOnly.primary_type === "audit", "review task should infer audit");
  assert(reviewOnly.route_id === "audit_functional_read_only", "review task should resolve to read-only audit route");
  assert(reviewOnly.task_modifiers.includes("read_only"), "review task should carry read_only modifier");
  assert(!reviewOnly.task_modifiers.includes("code_change_allowed"), "review task must not enable repo writes");

  const boardFix = buildTaskProfile({
    task_goal: "修复板端启动问题，并在真机上板验证日志和信号。",
    cwd
  });
  assert(boardFix.primary_type === "bug_fix", "board fix should still infer bug_fix");
  assert(boardFix.task_modifiers.includes("board_execution_required"), "board semantics should infer board execution");
  assert(boardFix.route_id === "bug_fix_board_validation", "board fix should resolve to board validation route");
  assert(boardFix.missing_context.includes("board_target"), "board route should report missing board_target when absent");

  const ambiguous = buildTaskProfile({
    task_goal: "Take a look at this and tell me what should happen next.",
    cwd
  });
  assert(ambiguous.primary_type === null, "ambiguous task should not force a primary_type");
  assert(ambiguous.route_id === null, "ambiguous task should not resolve a route");
  assert(ambiguous.requires_clarification, "ambiguous task should require clarification");

  console.log("cutepower task profile tests passed");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
