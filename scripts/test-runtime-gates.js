#!/usr/bin/env node

const { evaluateRuntimeRequest, loadContracts } = require("./runtime-gates");

const docs = loadContracts();

const positiveCases = [
  {
    name: "repo reviewer may collect artifacts in review state",
    request: {
      request_type: "review_decision",
      route_id: "implementation_board_validation",
      skill_id: "cute-code-review",
      role_id: "repo-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision", "artifact_collect"]
    }
  },
  {
    name: "functional reviewer may issue functional review on board route",
    request: {
      request_type: "review_decision",
      route_id: "audit_functional_board",
      skill_id: "cute-functional-review",
      role_id: "functional-reviewer",
      state: "review",
      review_type: "functional_review",
      requested_actions: ["review_decision", "artifact_collect"]
    }
  },
  {
    name: "incident investigator may orchestrate board evidence collection in analysis",
    request: {
      request_type: "skill_invocation",
      route_id: "incident_investigation_board",
      skill_id: "cute-incident-investigation",
      role_id: "incident-investigator",
      state: "analysis",
      requested_actions: ["board_execute", "artifact_collect"]
    }
  },
  {
    name: "incident insufficient evidence may only write project log",
    request: {
      request_type: "writeback",
      route_id: "incident_investigation_default",
      scenario: "insufficient_evidence",
      approval_gate: "analysis",
      writeback_level: "project_log_write",
      pass_statuses: []
    }
  }
];

const negativeCases = [
  {
    name: "legacy reviewer reference is rejected",
    request: {
      request_type: "review_decision",
      route_id: "bug_fix_default",
      skill_id: "cute-code-review",
      role_id: "reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision"]
    }
  },
  {
    name: "review state board_execute is rejected",
    request: {
      request_type: "review_decision",
      route_id: "implementation_board_validation",
      skill_id: "cute-code-review",
      role_id: "repo-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision", "board_execute"]
    }
  },
  {
    name: "non-board route reviewer artifact collection is rejected",
    request: {
      request_type: "review_decision",
      route_id: "bug_fix_default",
      skill_id: "cute-code-review",
      role_id: "repo-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision", "artifact_collect"]
    }
  },
  {
    name: "incident investigator may not request repo_write",
    request: {
      request_type: "skill_invocation",
      route_id: "incident_investigation_default",
      skill_id: "cute-incident-investigation",
      role_id: "incident-investigator",
      state: "analysis",
      requested_actions: ["repo_write"]
    }
  },
  {
    name: "functional review may not replace repo review",
    request: {
      request_type: "review_decision",
      route_id: "audit_functional_read_only",
      skill_id: "cute-functional-review",
      role_id: "functional-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision"]
    }
  },
  {
    name: "ambiguous review_passed is rejected for writeback",
    request: {
      request_type: "writeback",
      route_id: "bug_fix_default",
      scenario: "default",
      approval_gate: "review",
      writeback_level: "project_current_update",
      pass_statuses: ["review_passed"]
    }
  },
  {
    name: "incident skill may not be used as omnipotent total skill on implementation route",
    request: {
      request_type: "skill_invocation",
      route_id: "implementation_default",
      skill_id: "cute-incident-investigation",
      role_id: "incident-investigator",
      state: "analysis",
      requested_actions: ["verification_read"]
    }
  }
];

function runPositiveCase(testCase) {
  evaluateRuntimeRequest(testCase.request, docs);
  console.log(`PASS positive: ${testCase.name}`);
}

function runNegativeCase(testCase) {
  try {
    evaluateRuntimeRequest(testCase.request, docs);
    throw new Error(`expected failure but request passed: ${testCase.name}`);
  } catch (error) {
    console.log(`PASS negative: ${testCase.name} -> ${error.message}`);
  }
}

function main() {
  for (const testCase of positiveCases) {
    runPositiveCase(testCase);
  }
  for (const testCase of negativeCases) {
    runNegativeCase(testCase);
  }
  console.log("cutepower runtime gate tests passed");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
