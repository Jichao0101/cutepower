#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { deriveCurrentPhase, issueSessionCapability, syncRunSession } = require("./run-artifacts");
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
  const session = syncRunSession(path.join(intakePackage.artifact_plan.artifact_dir, "session.json"));
  const sessionCapability = explicit
    ? issueSessionCapability(session, {
        phase: intakePackage.phase,
        allowed_actions: runtimeLock.pre_intake_allowed_actions || []
      })
    : null;

  const actionGuard = {
    execution_mode: explicit ? "explicit_cutepower" : "default",
    intake_status: intakePackage.intake?.status || null,
    route_status: intakePackage.route_resolution?.route_status || null,
    runtime_gate_status: intakePackage.runtime_gate?.status || null,
    fallback_allowed: intakePackage.runtime_gate?.fallback_allowed === true,
    session_id: intakePackage.session_id,
    artifact_dir: intakePackage.artifact_plan?.artifact_dir || null,
    phase: intakePackage.phase
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
            required_terminal_outputs: intakePackage.artifact_plan?.terminal_artifacts || [],
            session_id: intakePackage.session_id,
            phase: intakePackage.phase,
            artifact_dir: intakePackage.artifact_plan?.artifact_dir || null,
            pre_ready_allowed_actions: runtimeLock.pre_intake_allowed_actions || [],
            blocked_until_ready: runtimeLock.protected_actions_before_ready || []
          }
        : null,
      action_guard: actionGuard,
      session_capability: sessionCapability
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

  const request = {
    ...actionRequest,
    ...(sessionEnvelope.host_runtime?.action_guard || {})
  };

  const explicit = request.execution_mode === "explicit_cutepower";
  const actions = Array.isArray(request.requested_actions)
    ? request.requested_actions
    : request.request_type === "writeback" && request.writeback_level
      ? [request.writeback_level]
      : [];
  const runtimeDiscoveryOnly = actions.length > 0 && actions.every((action) => action === "runtime_discovery_read");

  if (explicit && !runtimeDiscoveryOnly && !request.session_capability && request.artifact_dir) {
    const session = syncRunSession(path.join(request.artifact_dir, "session.json"));
    request.session_capability = issueSessionCapability(session, {
      phase: deriveCurrentPhase(session),
      route_id: request.route_id || session.route_id,
      allowed_actions: actions
    });
  } else if (!request.session_capability && sessionEnvelope.host_runtime?.session_capability) {
    request.session_capability = sessionEnvelope.host_runtime.session_capability;
  }

  return request;
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
