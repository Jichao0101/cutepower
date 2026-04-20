#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { loadContracts } = require("./runtime-gates");

const pluginRoot = path.resolve(__dirname, "..");

function profileError(message, context = {}) {
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

function countMatches(text, phrases = []) {
  return phrases.reduce((count, phrase) => count + (text.includes(String(phrase).toLowerCase()) ? 1 : 0), 0);
}

function inferPrimaryType(taskGoal, contract) {
  const text = normalizeText(taskGoal);
  const scored = (contract.primary_type_rules || [])
    .map((rule) => ({
      primary_type: rule.primary_type,
      matched_terms: (rule.match_any || []).filter((term) => text.includes(String(term).toLowerCase())),
      match_count: countMatches(text, rule.match_any),
      priority: rule.priority,
      add_modifiers: rule.add_modifiers || []
    }))
    .filter((entry) => entry.match_count > 0)
    .sort((left, right) => {
      if (right.match_count !== left.match_count) {
        return right.match_count - left.match_count;
      }
      return left.priority - right.priority;
    });

  if (scored.length === 0) {
    return {
      primary_type: null,
      inference_status: contract.guardrails.ambiguous_primary_type_result,
      evidence: []
    };
  }

  const winner = scored[0];
  const runnerUp = scored[1];
  const ambiguous = runnerUp && runnerUp.match_count === winner.match_count;

  return {
    primary_type: ambiguous ? null : winner.primary_type,
    inference_status: ambiguous ? contract.guardrails.ambiguous_primary_type_result : "resolved",
    evidence: winner.matched_terms,
    add_modifiers: ambiguous ? [] : winner.add_modifiers
  };
}

function inferModifiers(taskGoal, primaryTypeResult, contract) {
  const text = normalizeText(taskGoal);
  const modifiers = new Set(primaryTypeResult.add_modifiers || []);
  const evidence = {};

  for (const rule of contract.modifier_rules || []) {
    const matched = (rule.match_any || []).filter((term) => text.includes(String(term).toLowerCase()));
    if (matched.length > 0) {
      modifiers.add(rule.modifier);
      evidence[rule.modifier] = matched;
    }
  }

  if (primaryTypeResult.primary_type === "audit") {
    modifiers.add("functional_scope");
    modifiers.add("read_only");
  }

  if (contract.guardrails.strip_write_modifiers_when_read_only && modifiers.has("read_only")) {
    modifiers.delete("code_change_allowed");
  }

  return {
    task_modifiers: [...modifiers].sort(),
    modifier_evidence: evidence
  };
}

function resolveRoute(primaryType, taskModifiers, docs) {
  if (!primaryType) {
    return { route_id: null, route_status: "needs_clarification" };
  }

  const modifierSet = new Set(taskModifiers || []);
  const candidates = docs["routing-table"].routes
    .filter((route) => route.primary_type === primaryType)
    .filter((route) => (route.modifiers || []).every((modifier) => modifierSet.has(modifier)))
    .sort((left, right) => (right.modifiers || []).length - (left.modifiers || []).length);

  if (candidates.length === 0) {
    return { route_id: null, route_status: "needs_clarification" };
  }

  const best = candidates[0];
  const second = candidates[1];
  if (second && (second.modifiers || []).length === (best.modifiers || []).length) {
    return { route_id: null, route_status: "needs_clarification" };
  }

  return {
    route_id: best.route_id,
    route_status: "resolved",
    route: best
  };
}

function inferContextFields(request, primaryType, taskModifiers, contract) {
  const text = normalizeText(request.task_goal);
  const modifierSet = new Set(taskModifiers || []);
  const context = {};
  const missing_context = [];

  for (const rule of contract.context_rules || []) {
    let required = false;

    if ((rule.required_for_primary_types || []).includes(primaryType)) {
      required = true;
    }
    if ((rule.required_when_modifiers || []).some((modifier) => modifierSet.has(modifier))) {
      required = true;
    }
    if ((rule.required_when_keywords || []).some((term) => text.includes(String(term).toLowerCase()))) {
      required = true;
    }

    if (!required) {
      continue;
    }

    if (request[rule.field_id]) {
      context[rule.field_id] = request[rule.field_id];
      continue;
    }

    if (rule.infer_from === "cwd") {
      context[rule.field_id] = request.cwd || pluginRoot;
      continue;
    }

    if (rule.missing_behavior === "prompt_gap") {
      missing_context.push(rule.field_id);
    }
  }

  return { context, missing_context };
}

function buildTaskProfile(request, docs = loadContracts()) {
  if (!request || typeof request !== "object") {
    throw profileError("task profile request must be an object");
  }
  if (!request.task_goal || typeof request.task_goal !== "string") {
    throw profileError("task profile request requires task_goal");
  }

  const normalization = docs["task-normalization"];
  if (!normalization) {
    throw profileError("task-normalization contract is required");
  }

  const primaryTypeResult = inferPrimaryType(request.task_goal, normalization);
  const modifierResult = inferModifiers(request.task_goal, primaryTypeResult, normalization);
  const routeResult = resolveRoute(primaryTypeResult.primary_type, modifierResult.task_modifiers, docs);
  const contextResult = inferContextFields(
    { ...request, cwd: request.cwd || pluginRoot },
    primaryTypeResult.primary_type,
    modifierResult.task_modifiers,
    normalization
  );

  return {
    entry_skill: normalization.activation.entry_skill,
    task_goal: request.task_goal,
    primary_type: primaryTypeResult.primary_type,
    primary_type_status: primaryTypeResult.inference_status,
    task_modifiers: modifierResult.task_modifiers,
    route_id: routeResult.route_id,
    route_status: routeResult.route_status,
    inferred_context: contextResult.context,
    missing_context: contextResult.missing_context,
    requires_clarification:
      primaryTypeResult.inference_status !== "resolved" ||
      routeResult.route_status !== "resolved" ||
      contextResult.missing_context.length > 0,
    inference_trace: {
      primary_type_terms: primaryTypeResult.evidence || [],
      modifier_terms: modifierResult.modifier_evidence
    }
  };
}

function main() {
  const request = readRequestFromCli(process.argv.slice(2));
  const profile = buildTaskProfile(request);
  console.log(JSON.stringify(profile, null, 2));
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
  buildTaskProfile,
  inferPrimaryType,
  inferModifiers,
  resolveRoute
};
