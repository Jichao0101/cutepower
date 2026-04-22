#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const pluginRoot = path.resolve(__dirname, "..");

function readJsonLike(relativePath) {
  const fullPath = path.join(pluginRoot, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function loadContracts() {
  const index = readJsonLike("contracts/contract-index.yaml");
  const docs = {};
  for (const entry of index.contracts) {
    docs[entry.id] = readJsonLike(entry.path);
  }
  return docs;
}

function gateError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

function ensureArray(name, value) {
  if (!Array.isArray(value)) {
    throw gateError(`${name} must be an array`);
  }
}

function ensureObject(name, value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw gateError(`${name} must be an object`);
  }
}

function getRuntimeEntry(docs) {
  return docs["task-normalization"]?.activation?.runtime_entry || {};
}

function getRouteSegment(route, skillId, roleId) {
  const mainSkills = [route.entry_skill, ...(route.skill_chain || [])];
  if (mainSkills.includes(skillId) && (route.required_roles || []).includes(roleId)) {
    return { segment_type: "main" };
  }

  for (const handoff of route.conditional_handoffs || []) {
    if ((handoff.skill_chain || []).includes(skillId) && (handoff.required_roles || []).includes(roleId)) {
      return { segment_type: "conditional_handoff", handoff };
    }
  }

  return null;
}

function routeSupportsBoardActions(route) {
  return (route.modifiers || []).includes("board_execution_required");
}

function assertKnownRole(roleId, docs) {
  const alias = (docs["role-contracts"].role_aliases || []).find((entry) => entry.legacy_role_id === roleId);
  if (alias) {
    throw gateError(`legacy role alias is not allowed at runtime: ${roleId}`, { canonical_role_id: alias.canonical_role_id });
  }

  const role = docs["role-contracts"].roles.find((entry) => entry.role_id === roleId);
  if (!role) {
    throw gateError(`unknown runtime role: ${roleId}`);
  }
  return role;
}

function assertKnownRoute(routeId, docs) {
  const route = docs["routing-table"].routes.find((entry) => entry.route_id === routeId);
  if (!route) {
    throw gateError(`unknown route_id: ${routeId}`);
  }
  return route;
}

function assertStateAllowsActions(state, requestedActions, docs) {
  const rule = docs["gate-matrix"].rules.find((entry) => entry.state === state);
  if (!rule) {
    throw gateError(`unknown gate state: ${state}`);
  }
  for (const action of requestedActions) {
    if ((rule.deny || []).includes(action)) {
      throw gateError(`action denied in state ${state}: ${action}`, { state, action });
    }
    if (!(rule.allow || []).includes(action)) {
      throw gateError(`action not explicitly allowed in state ${state}: ${action}`, { state, action });
    }
  }
  return rule;
}

function assertExplicitCutepowerRuntimeLock(request, docs) {
  const runtimeEntry = getRuntimeEntry(docs);
  const mode = request.execution_mode || "default";
  if (mode !== "explicit_cutepower") {
    return;
  }

  const intakeStatus = request.intake_status || null;
  const routeStatus = request.route_status || null;
  const runtimeGateStatus = request.runtime_gate_status || null;
  const fallbackAllowed = request.fallback_allowed === true;
  const requestedActions = Array.isArray(request.requested_actions) ? request.requested_actions : [];
  const allowedPreIntakeActions = new Set(runtimeEntry.pre_intake_allowed_actions || []);
  const protectedBeforeReady = new Set(runtimeEntry.protected_actions_before_ready || []);
  const protectedSkills = new Set(runtimeEntry.protected_execution_skills || []);

  if (runtimeGateStatus === "declined" && fallbackAllowed) {
    return;
  }

  const runtimeReady =
    intakeStatus === "accepted" &&
    routeStatus === "resolved" &&
    runtimeGateStatus === "ready";

  if (runtimeReady) {
    return;
  }

  for (const action of requestedActions) {
    if (!allowedPreIntakeActions.has(action) || protectedBeforeReady.has(action)) {
      throw gateError(`explicit cutepower mode requires intake/route/gate before action ${action}`, {
        action,
        intake_status: intakeStatus,
        route_status: routeStatus,
        runtime_gate_status: runtimeGateStatus
      });
    }
  }

  if (request.skill_id && protectedSkills.has(request.skill_id)) {
    throw gateError(`explicit cutepower mode requires intake/route/gate before skill ${request.skill_id}`, {
      skill_id: request.skill_id,
      intake_status: intakeStatus,
      route_status: routeStatus,
      runtime_gate_status: runtimeGateStatus
    });
  }
}

function assertRoleAllowsActions(role, requestedActions) {
  for (const action of requestedActions) {
    if (!(role.allowed_actions || []).includes(action)) {
      throw gateError(`role ${role.role_id} may not perform action ${action}`, { role_id: role.role_id, action });
    }
  }
}

function assertBoardReviewConstraints(request, docs) {
  const boardActions = new Set(docs["gate-matrix"].board_policy.board_actions || []);
  const requestedBoardActions = (request.requested_actions || []).filter((action) => boardActions.has(action));
  if (requestedBoardActions.length === 0) {
    return;
  }

  if (request.state !== "review") {
    return;
  }

  const constraints = docs["gate-matrix"].board_policy.review_stage_constraints;
  if (!constraints.allowed_roles.includes(request.role_id)) {
    throw gateError(`role ${request.role_id} may not use board actions in review state`, {
      role_id: request.role_id,
      state: request.state
    });
  }

  for (const action of requestedBoardActions) {
    if (!constraints.allowed_board_actions.includes(action)) {
      throw gateError(`review-state board action is forbidden: ${action}`, {
        role_id: request.role_id,
        state: request.state,
        action
      });
    }
  }
}

function assertRouteSkillRoleBinding(request, docs) {
  const route = assertKnownRoute(request.route_id, docs);
  const segment = getRouteSegment(route, request.skill_id, request.role_id);
  if (!segment) {
    throw gateError(`skill/role pair is not allowed on route ${request.route_id}`, {
      route_id: request.route_id,
      skill_id: request.skill_id,
      role_id: request.role_id
    });
  }
  return { route, segment };
}

function assertBoardRouteConstraints(request, route, docs) {
  const boardActions = new Set(docs["gate-matrix"].board_policy.board_actions || []);
  const requestedBoardActions = (request.requested_actions || []).filter((action) => boardActions.has(action));
  if (requestedBoardActions.length === 0) {
    return;
  }

  if (!routeSupportsBoardActions(route)) {
    throw gateError(`board actions require a board-enabled route: ${route.route_id}`, {
      route_id: route.route_id,
      requested_board_actions: requestedBoardActions
    });
  }
}

function assertRuntimeDiscoveryInvocation(request, role) {
  const actions = request.requested_actions || [];
  const runtimeDiscoveryOnly = actions.length > 0 && actions.every((action) => action === "runtime_discovery_read");
  if (!runtimeDiscoveryOnly) {
    return false;
  }

  if (request.skill_id !== "using-cutepower") {
    throw gateError("runtime discovery reads must run through using-cutepower", {
      skill_id: request.skill_id
    });
  }

  assertRoleAllowsActions(role, actions);
  return true;
}

function assertIndependentReview(request, reviewType) {
  const independence = reviewType.independence_requirements || {};
  ensureArray("evidence_keys", request.evidence_keys);

  if (independence.require_explicit_reviewer_identity) {
    if (!request.reviewer_stage_id && !request.reviewer_instance_id) {
      throw gateError("review requires explicit reviewer stage or instance identity");
    }
  }

  if (independence.separate_reviewer_stage_or_instance) {
    const sameStage =
      request.author_stage_id != null &&
      request.reviewer_stage_id != null &&
      request.author_stage_id === request.reviewer_stage_id;
    const sameInstance =
      request.author_instance_id != null &&
      request.reviewer_instance_id != null &&
      request.author_instance_id === request.reviewer_instance_id;

    if (sameStage && sameInstance) {
      throw gateError("review requires a separate reviewer stage or instance", {
        author_stage_id: request.author_stage_id,
        reviewer_stage_id: request.reviewer_stage_id,
        author_instance_id: request.author_instance_id,
        reviewer_instance_id: request.reviewer_instance_id
      });
    }

    if (!request.reviewer_stage_id && !request.reviewer_instance_id) {
      throw gateError("review requires a separate reviewer stage or instance");
    }
  }

  if (independence.author_self_review_forbidden) {
    if (
      request.author_instance_id != null &&
      request.reviewer_instance_id != null &&
      request.author_instance_id === request.reviewer_instance_id
    ) {
      throw gateError("author self-review cannot satisfy independent review", {
        author_instance_id: request.author_instance_id,
        reviewer_instance_id: request.reviewer_instance_id
      });
    }
  }

  if (independence.allow_full_author_context === false && request.inherit_full_author_context === true) {
    throw gateError("review may not inherit full author context");
  }

  if (independence.allow_full_author_reasoning === false && request.inherit_full_author_reasoning === true) {
    throw gateError("review may not inherit full author reasoning");
  }

  if (independence.use_minimum_evidence_package) {
    const evidence = new Set(request.evidence_keys);
    for (const field of reviewType.minimum_evidence_package || []) {
      if (!evidence.has(field)) {
        throw gateError(`review missing minimum evidence field ${field}`, {
          missing_field: field
        });
      }
    }
  }
}

function assertWritebackPreconditions(request, matrixEntry, docs) {
  ensureArray("completed_preconditions", request.completed_preconditions);
  const levels = docs["writeback-levels"].levels || [];
  const level = levels.find((entry) => entry.level_id === request.writeback_level);
  if (!level) {
    throw gateError(`unknown writeback level: ${request.writeback_level}`);
  }

  const role = assertKnownRole(request.actor_role_id, docs);
  assertRoleAllowsActions(role, [request.writeback_level]);

  const completed = new Set(request.completed_preconditions);
  const requiredPreconditions = new Set([...(level.required_preconditions || []), ...(matrixEntry.required_preconditions || [])]);
  for (const precondition of requiredPreconditions) {
    if (!completed.has(precondition)) {
      throw gateError(`missing required writeback precondition ${precondition}`, {
        route_id: request.route_id,
        scenario: request.scenario,
        writeback_level: request.writeback_level
      });
    }
  }

  if (request.writeback_level === "project_current_update") {
    ensureObject("adjudication", request.adjudication);

    if (!request.adjudication.adjudicator_instance_id) {
      throw gateError("project_current_update requires adjudicator_instance_id");
    }
    if (
      request.author_instance_id != null &&
      request.adjudication.adjudicator_instance_id === request.author_instance_id
    ) {
      throw gateError("project_current_update requires non-author adjudication", {
        author_instance_id: request.author_instance_id,
        adjudicator_instance_id: request.adjudication.adjudicator_instance_id
      });
    }
  }
}

function evaluateSkillInvocation(request, docs) {
  ensureArray("requested_actions", request.requested_actions);
  const role = assertKnownRole(request.role_id, docs);
  if (assertRuntimeDiscoveryInvocation(request, role)) {
    return {
      ok: true,
      request_type: request.request_type
    };
  }
  const { route } = assertRouteSkillRoleBinding(request, docs);
  assertRoleAllowsActions(role, request.requested_actions);
  assertStateAllowsActions(request.state, request.requested_actions, docs);
  assertBoardRouteConstraints(request, route, docs);
  assertBoardReviewConstraints(request, docs);

  return {
    ok: true,
    request_type: request.request_type
  };
}

function evaluateReviewDecision(request, docs) {
  ensureArray("requested_actions", request.requested_actions);
  if (request.review_type == null) {
    throw gateError("review_decision request requires review_type");
  }

  const reviewType = docs["review-boundaries"].review_types.find((entry) => entry.review_type === request.review_type);
  if (!reviewType) {
    throw gateError(`unknown review_type: ${request.review_type}`);
  }

  const role = assertKnownRole(request.role_id, docs);
  const { route } = assertRouteSkillRoleBinding(request, docs);
  assertRoleAllowsActions(role, request.requested_actions);
  assertStateAllowsActions(request.state, request.requested_actions, docs);
  assertBoardRouteConstraints(request, route, docs);
  assertBoardReviewConstraints(request, docs);

  if (reviewType.reviewer_role_id !== request.role_id) {
    throw gateError(`review_type ${request.review_type} must be owned by ${reviewType.reviewer_role_id}`, {
      review_type: request.review_type,
      role_id: request.role_id
    });
  }
  if (reviewType.skill_id !== request.skill_id) {
    throw gateError(`review_type ${request.review_type} must run through skill ${reviewType.skill_id}`, {
      review_type: request.review_type,
      skill_id: request.skill_id
    });
  }
  if (!request.requested_actions.includes("review_decision")) {
    throw gateError("review_decision request must include review_decision action");
  }
  assertIndependentReview(request, reviewType);

  return {
    ok: true,
    request_type: request.request_type
  };
}

function evaluateWriteback(request, docs) {
  ensureArray("pass_statuses", request.pass_statuses);
  if (request.actor_role_id == null) {
    throw gateError("writeback request requires actor_role_id");
  }
  if (request.route_id == null || request.scenario == null || request.writeback_level == null || request.approval_gate == null) {
    throw gateError("writeback request requires route_id, scenario, approval_gate, and writeback_level");
  }

  const matrixEntry = docs["writeback-levels"].route_writeback_matrix.find(
    (entry) => entry.route_id === request.route_id && entry.scenario === request.scenario
  );
  if (!matrixEntry) {
    throw gateError(`no writeback matrix entry for route ${request.route_id} scenario ${request.scenario}`);
  }

  const knownPassStatuses = new Set(docs["writeback-levels"].pass_statuses.map((entry) => entry.pass_id));
  for (const passStatus of request.pass_statuses) {
    if (!knownPassStatuses.has(passStatus)) {
      throw gateError(`unknown or ambiguous pass status: ${passStatus}`, { pass_status: passStatus });
    }
  }

  if (matrixEntry.required_gate !== request.approval_gate) {
    throw gateError(`writeback approval gate mismatch: expected ${matrixEntry.required_gate}, got ${request.approval_gate}`, {
      route_id: request.route_id,
      scenario: request.scenario
    });
  }
  if (matrixEntry.allowed_writeback_level !== request.writeback_level) {
    throw gateError(`writeback level mismatch: expected ${matrixEntry.allowed_writeback_level}, got ${request.writeback_level}`, {
      route_id: request.route_id,
      scenario: request.scenario
    });
  }
  for (const forbiddenLevel of matrixEntry.forbidden_writeback_levels || []) {
    if (request.writeback_level === forbiddenLevel) {
      throw gateError(`writeback level is forbidden for route scenario: ${forbiddenLevel}`, {
        route_id: request.route_id,
        scenario: request.scenario
      });
    }
  }
  for (const passStatus of matrixEntry.required_passes || []) {
    if (!request.pass_statuses.includes(passStatus)) {
      throw gateError(`missing required pass status ${passStatus} for route ${request.route_id}`, {
        route_id: request.route_id,
        scenario: request.scenario
      });
    }
  }
  assertWritebackPreconditions(request, matrixEntry, docs);

  return {
    ok: true,
    request_type: request.request_type
  };
}

function evaluateRuntimeRequest(request, docs = loadContracts()) {
  if (!request || typeof request !== "object") {
    throw gateError("request must be an object");
  }

  assertExplicitCutepowerRuntimeLock(request, docs);

  switch (request.request_type) {
    case "skill_invocation":
      return evaluateSkillInvocation(request, docs);
    case "review_decision":
      return evaluateReviewDecision(request, docs);
    case "writeback":
      return evaluateWriteback(request, docs);
    default:
      throw gateError(`unsupported request_type: ${request.request_type}`);
  }
}

function readRequestFromCli(args) {
  if (args.length === 0 || args[0] === "--stdin") {
    const input = fs.readFileSync(0, "utf8");
    return JSON.parse(input);
  }
  return JSON.parse(fs.readFileSync(path.resolve(args[0]), "utf8"));
}

function main() {
  const request = readRequestFromCli(process.argv.slice(2));
  const result = evaluateRuntimeRequest(request);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const payload = {
      ok: false,
      error: error.message,
      context: error.context || {}
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}

module.exports = {
  evaluateRuntimeRequest,
  loadContracts
};
