#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { buildTaskProfile } = require("./task-profile");
const { loadContracts } = require("./runtime-gates");

const pluginRoot = path.resolve(__dirname, "..");

function intakeError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

function readRequestFromCli(args) {
  if (args.length === 0 || args[0] === "--stdin") {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  }
  return JSON.parse(fs.readFileSync(path.resolve(args[0]), "utf8"));
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function getRouteById(routeId, docs) {
  return docs["routing-table"].routes.find((route) => route.route_id === routeId) || null;
}

function detectRuntimeDiscovery(taskGoal, docs) {
  const config = docs["task-normalization"].activation.runtime_discovery || {};
  const text = normalizeText(taskGoal);
  const matchedKeywords = (config.keywords || []).filter((keyword) => text.includes(String(keyword).toLowerCase()));

  return {
    requested: matchedKeywords.length > 0,
    matched_keywords: matchedKeywords,
    allowed_roots: config.allowed_roots || []
  };
}

function summarizeContextRequirements(taskProfile, runtimeDiscovery) {
  const requirements = [];

  for (const fieldId of Object.keys(taskProfile.inferred_context || {}).sort()) {
    requirements.push({
      field_id: fieldId,
      status: "resolved",
      value: taskProfile.inferred_context[fieldId]
    });
  }

  for (const fieldId of taskProfile.missing_context || []) {
    requirements.push({
      field_id: fieldId,
      status: "missing"
    });
  }

  if (runtimeDiscovery.requested) {
    requirements.push({
      field_id: "runtime_discovery",
      status: "resolved",
      value: runtimeDiscovery.allowed_roots
    });
  }

  return requirements;
}

function buildBlockingGaps(taskProfile, route, request, docs, runtimeDiscovery) {
  const gaps = [];
  const authorizations = request.authorizations || {};
  const missingContext = new Set(taskProfile.missing_context || []);

  for (const fieldId of missingContext) {
    gaps.push({
      gap_id: fieldId,
      gap_type: "context_missing",
      message: `missing required context: ${fieldId}`
    });
  }

  if (runtimeDiscovery.requested && authorizations.knowledge_read === false) {
    // Runtime discovery is handled from runtime roots and must not be blocked as knowledge context.
  }

  const roleSet = new Set(route?.required_roles || []);
  if (roleSet.has("repo-coder") && authorizations.repo_write !== true) {
    gaps.push({
      gap_id: "repo_write_authorization",
      gap_type: "authorization_missing",
      message: "repo write authorization is required before repo-change handoff"
    });
  }

  if ((taskProfile.missing_context || []).includes("knowledge_base_root") || request.knowledge_base_root) {
    if (authorizations.knowledge_read !== true) {
      gaps.push({
        gap_id: "knowledge_read_authorization",
        gap_type: "authorization_missing",
        message: "knowledge read authorization is required for knowledge-base context"
      });
    }
  }

  if ((taskProfile.task_modifiers || []).includes("board_execution_required") && authorizations.board_execute !== true) {
    gaps.push({
      gap_id: "board_execute_authorization",
      gap_type: "authorization_missing",
      message: "board execution authorization is required before board-run handoff"
    });
  }

  return gaps;
}

function buildHandoff(taskProfile, route) {
  if (!route) {
    return null;
  }

  const nextSkill = (route.skill_chain || [])[0] || null;
  return {
    entry_skill: route.entry_skill,
    next_skill: nextSkill,
    route_id: route.route_id,
    required_roles: route.required_roles || [],
    required_gates: route.required_gates || [],
    conditional_handoffs: route.conditional_handoffs || []
  };
}

function buildRouteResolution(taskProfile, route, docs) {
  const activation = docs["task-normalization"].activation;
  const autostartPrimaryTypes = new Set(activation.autostart_primary_types || []);

  return {
    entry_skill: activation.entry_skill,
    autostart_enabled: autostartPrimaryTypes.has(taskProfile.primary_type),
    primary_type: taskProfile.primary_type,
    primary_type_status: taskProfile.primary_type_status,
    route_id: taskProfile.route_id,
    route_status: taskProfile.route_status,
    fallback_behavior: activation.fallback_behavior,
    skill_chain: route?.skill_chain || []
  };
}

function buildRuntimeGate(taskProfile, routeResolution, blockingGaps) {
  if (!routeResolution.autostart_enabled) {
    return {
      status: "declined",
      reason: "primary_type_not_autostarted",
      fallback_allowed: true
    };
  }

  if (taskProfile.primary_type_status !== "resolved" || taskProfile.route_status !== "resolved") {
    return {
      status: "clarification_required",
      reason: "route_resolution_incomplete",
      fallback_allowed: false
    };
  }

  if (blockingGaps.length > 0) {
    return {
      status: "blocked",
      reason: "blocking_gaps",
      fallback_allowed: false
    };
  }

  return {
    status: "ready",
    reason: "cutepower_takeover",
    fallback_allowed: false
  };
}

function buildIntakePackage(request, docs = loadContracts()) {
  if (!request || typeof request !== "object") {
    throw intakeError("task intake request must be an object");
  }
  if (!request.task_goal || typeof request.task_goal !== "string") {
    throw intakeError("task intake request requires task_goal");
  }

  const taskProfile = buildTaskProfile(request, docs);
  const route = getRouteById(taskProfile.route_id, docs);
  const runtimeDiscovery = detectRuntimeDiscovery(request.task_goal, docs);
  const routeResolution = buildRouteResolution(taskProfile, route, docs);
  const contextRequirements = summarizeContextRequirements(taskProfile, runtimeDiscovery);
  const blockingGaps = buildBlockingGaps(taskProfile, route, request, docs, runtimeDiscovery);
  const runtimeGate = buildRuntimeGate(taskProfile, routeResolution, blockingGaps);

  return {
    entry_skill: docs["task-normalization"].activation.entry_skill,
    task_profile: taskProfile,
    intake: {
      status: runtimeGate.status === "ready" ? "accepted" : runtimeGate.status,
      preflight_completed: true
    },
    route_resolution: routeResolution,
    context_requirements: contextRequirements,
    blocking_gaps: blockingGaps,
    runtime_discovery: runtimeDiscovery,
    skill_handoff: runtimeGate.status === "ready" ? buildHandoff(taskProfile, route) : null,
    runtime_gate: runtimeGate
  };
}

function main() {
  const request = readRequestFromCli(process.argv.slice(2));
  const intakePackage = buildIntakePackage(request);
  console.log(JSON.stringify(intakePackage, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error.message,
          context: error.context || {}
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

module.exports = {
  buildIntakePackage,
  detectRuntimeDiscovery
};
