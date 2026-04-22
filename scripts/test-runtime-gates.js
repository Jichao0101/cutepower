#!/usr/bin/env node

const { evaluateRuntimeRequest, loadContracts } = require("./runtime-gates");

const docs = loadContracts();

const positiveCases = [
  {
    name: "repo reviewer may collect artifacts in review state",
    request: {
      request_type: "review_decision",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "implementation_board_validation",
      skill_id: "cute-code-review",
      role_id: "repo-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision", "artifact_collect"],
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
    }
  },
  {
    name: "functional reviewer may issue functional review on board route",
    request: {
      request_type: "review_decision",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "audit_functional_board",
      skill_id: "cute-functional-review",
      role_id: "functional-reviewer",
      state: "review",
      review_type: "functional_review",
      requested_actions: ["review_decision", "artifact_collect"],
      evidence_keys: [
        "requirements_package",
        "acceptance_items",
        "interface_contracts",
        "evidence_package"
      ],
      author_stage_id: "analysis",
      reviewer_stage_id: "review",
      author_instance_id: "planner-1",
      reviewer_instance_id: "functional-reviewer-1",
      inherit_full_author_context: false,
      inherit_full_author_reasoning: false
    }
  },
  {
    name: "incident investigator may orchestrate board evidence collection in analysis",
    request: {
      request_type: "skill_invocation",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
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
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "incident_investigation_default",
      scenario: "insufficient_evidence",
      approval_gate: "analysis",
      writeback_level: "project_log_write",
      pass_statuses: [],
      actor_role_id: "incident-investigator",
      completed_preconditions: [
        "task_has_traceable_record",
        "route_writeback_requirements_satisfied",
        "investigation_route_recorded_when_required"
      ]
    }
  },
  {
    name: "runtime discovery read is allowed before intake completion in explicit mode",
    request: {
      request_type: "skill_invocation",
      execution_mode: "explicit_cutepower",
      intake_status: null,
      route_status: null,
      runtime_gate_status: null,
      skill_id: "using-cutepower",
      role_id: "workflow-orchestrator",
      requested_actions: ["runtime_discovery_read"]
    }
  }
];

const negativeCases = [
  {
    name: "legacy reviewer reference is rejected",
    request: {
      request_type: "review_decision",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "bug_fix_default",
      skill_id: "cute-code-review",
      role_id: "reviewer",
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
      reviewer_instance_id: "reviewer-1"
    }
  },
  {
    name: "review state board_execute is rejected",
    request: {
      request_type: "review_decision",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "implementation_board_validation",
      skill_id: "cute-code-review",
      role_id: "repo-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision", "board_execute"],
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
      reviewer_instance_id: "reviewer-1"
    }
  },
  {
    name: "non-board route reviewer artifact collection is rejected",
    request: {
      request_type: "review_decision",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "bug_fix_default",
      skill_id: "cute-code-review",
      role_id: "repo-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision", "artifact_collect"],
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
      reviewer_instance_id: "reviewer-1"
    }
  },
  {
    name: "incident investigator may not request repo_write",
    request: {
      request_type: "skill_invocation",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
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
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "audit_functional_read_only",
      skill_id: "cute-functional-review",
      role_id: "functional-reviewer",
      state: "review",
      review_type: "repo_review",
      requested_actions: ["review_decision"],
      evidence_keys: [
        "requirements_package",
        "acceptance_items",
        "interface_contracts",
        "evidence_package"
      ],
      author_stage_id: "analysis",
      reviewer_stage_id: "review",
      author_instance_id: "author-1",
      reviewer_instance_id: "reviewer-1"
    }
  },
  {
    name: "ambiguous review_passed is rejected for writeback",
    request: {
      request_type: "writeback",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "bug_fix_default",
      scenario: "default",
      approval_gate: "review",
      writeback_level: "project_current_update",
      pass_statuses: ["review_passed"],
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
    }
  },
  {
    name: "incident skill may not be used as omnipotent total skill on implementation route",
    request: {
      request_type: "skill_invocation",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "implementation_default",
      skill_id: "cute-incident-investigation",
      role_id: "incident-investigator",
      state: "analysis",
      requested_actions: ["verification_read"]
    }
  },
  {
    name: "explicit cutepower mode blocks business code read before intake",
    request: {
      request_type: "skill_invocation",
      execution_mode: "explicit_cutepower",
      intake_status: null,
      route_status: null,
      runtime_gate_status: null,
      skill_id: "using-cutepower",
      role_id: "workflow-orchestrator",
      requested_actions: ["business_context_read"]
    }
  },
  {
    name: "explicit cutepower mode blocks repo change before route resolution",
    request: {
      request_type: "skill_invocation",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "needs_clarification",
      runtime_gate_status: "clarification_required",
      route_id: "bug_fix_default",
      skill_id: "cute-repo-change",
      role_id: "repo-coder",
      state: "implementation",
      requested_actions: ["repo_write"]
    }
  },
  {
    name: "author self-check is not an independent review pass",
    request: {
      request_type: "review_decision",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
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
      reviewer_instance_id: "author-1",
      inherit_full_author_context: false,
      inherit_full_author_reasoning: false
    }
  },
  {
    name: "review without independent reviewer identity is blocked",
    request: {
      request_type: "review_decision",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
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
      ]
    }
  },
  {
    name: "writeback without required passes or gate preconditions is rejected",
    request: {
      request_type: "writeback",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
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
  },
  {
    name: "author cannot unilaterally trigger project_current_update",
    request: {
      request_type: "writeback",
      execution_mode: "explicit_cutepower",
      intake_status: "accepted",
      route_status: "resolved",
      runtime_gate_status: "ready",
      route_id: "bug_fix_default",
      scenario: "default",
      approval_gate: "review",
      writeback_level: "project_current_update",
      pass_statuses: ["repo_review_passed"],
      actor_role_id: "workflow-orchestrator",
      author_instance_id: "author-1",
      adjudication: {
        adjudicator_instance_id: "author-1"
      },
      completed_preconditions: [
        "writeback_state_reached",
        "route_writeback_requirements_satisfied",
        "review_pass_recorded",
        "independent_writeback_adjudication"
      ]
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
