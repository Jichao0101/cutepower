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

function evaluateSkillInvocation(request, docs) {
  ensureArray("requested_actions", request.requested_actions);
  const role = assertKnownRole(request.role_id, docs);
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

  return {
    ok: true,
    request_type: request.request_type
  };
}

function evaluateWriteback(request, docs) {
  ensureArray("pass_statuses", request.pass_statuses);
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

  return {
    ok: true,
    request_type: request.request_type
  };
}

function evaluateRuntimeRequest(request, docs = loadContracts()) {
  if (!request || typeof request !== "object") {
    throw gateError("request must be an object");
  }

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
