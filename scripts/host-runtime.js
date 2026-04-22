#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { buildIntakePackage } = require("./task-intake");
const { evaluateRuntimeRequest, loadContracts } = require("./runtime-gates");

function hostRuntimeError(message, context = {}) {
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

function buildSessionContextEnvelope(request, docs = loadContracts()) {
  const intakePackage = buildIntakePackage(request, docs);
  const explicit = intakePackage.execution_mode?.requested === true;
  const runtimeLock = intakePackage.execution_policy?.runtime_lock || {};

  const actionGuard = {
    execution_mode: explicit ? "explicit_cutepower" : "default",
    intake_status: intakePackage.intake?.status || null,
    route_status: intakePackage.route_resolution?.route_status || null,
    runtime_gate_status: intakePackage.runtime_gate?.status || null,
    fallback_allowed: intakePackage.runtime_gate?.fallback_allowed === true
  };

  const warnings = explicit
    ? [
        "cutepower explicit mode is active",
        "run using-cutepower intake/preflight before business reads or execution",
        "before task_profile + route_resolution + runtime_gate are ready, only runtime discovery is allowed",
        "blocked or clarification_required may not silently fall back",
        "author self-check is not an independent review pass",
        "writeback may not be made effective by the author alone"
      ]
    : [];

  return {
    entry_skill: docs["task-normalization"].activation.entry_skill,
    intake_package: intakePackage,
    host_runtime: {
      explicit_mode: explicit,
      inject_session_context: explicit,
      session_context: explicit
        ? {
            entry_skill: docs["task-normalization"].activation.entry_skill,
            warning_lines: warnings,
            required_preflight_outputs: [
              "task_profile",
              "route_resolution",
              "runtime_gate",
              "context_requirements",
              "blocking_gaps"
            ],
            pre_ready_allowed_actions: runtimeLock.pre_intake_allowed_actions || [],
            blocked_until_ready: runtimeLock.protected_actions_before_ready || []
          }
        : null,
      action_guard: actionGuard
    }
  };
}

function prepareActionRequest(actionRequest, sessionEnvelope) {
  if (!actionRequest || typeof actionRequest !== "object") {
    throw hostRuntimeError("actionRequest must be an object");
  }
  if (!sessionEnvelope || typeof sessionEnvelope !== "object") {
    throw hostRuntimeError("sessionEnvelope must be an object");
  }

  return {
    ...actionRequest,
    ...(sessionEnvelope.host_runtime?.action_guard || {})
  };
}

function evaluateActionWithSession(actionRequest, sessionEnvelope, docs = loadContracts()) {
  const request = prepareActionRequest(actionRequest, sessionEnvelope);
  return evaluateRuntimeRequest(request, docs);
}

function main() {
  const request = readRequestFromCli(process.argv.slice(2));
  const result = buildSessionContextEnvelope(request);
  console.log(JSON.stringify(result, null, 2));
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
  buildSessionContextEnvelope,
  prepareActionRequest,
  evaluateActionWithSession
};
