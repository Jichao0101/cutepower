#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const pluginRoot = path.resolve(__dirname, "..");

const ARTIFACT_SPECS = {
  task_profile: {
    filename: "task_profile.json",
    schemaPath: "schemas/run-artifacts/task_profile.json"
  },
  route_resolution: {
    filename: "route_resolution.json",
    schemaPath: "schemas/run-artifacts/route_resolution.json"
  },
  runtime_gate: {
    filename: "runtime_gate.json",
    schemaPath: "schemas/run-artifacts/runtime_gate.json"
  },
  context_requirements: {
    filename: "context_requirements.json",
    schemaPath: "schemas/run-artifacts/context_requirements.json"
  },
  blocking_gaps: {
    filename: "blocking_gaps.json",
    schemaPath: "schemas/run-artifacts/blocking_gaps.json"
  },
  evidence_manifest: {
    filename: "evidence_manifest.json",
    schemaPath: "schemas/run-artifacts/evidence_manifest.json"
  },
  review_decision: {
    filename: "review_decision.json",
    schemaPath: "schemas/run-artifacts/review_decision.json"
  },
  writeback_receipt: {
    filename: "writeback_receipt.json",
    schemaPath: "schemas/run-artifacts/writeback_receipt.json"
  },
  writeback_declined: {
    filename: "writeback_declined.json",
    schemaPath: "schemas/run-artifacts/writeback_declined.json"
  }
};

const PRE_FLIGHT_ARTIFACTS = [
  "task_profile",
  "route_resolution",
  "runtime_gate",
  "context_requirements",
  "blocking_gaps"
];

function artifactError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createSessionId() {
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${crypto.randomBytes(4).toString("hex")}`;
}

function getRunRoot(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot), ".cutepower", "run");
}

function getArtifactDir(workspaceRoot, sessionId) {
  return path.join(getRunRoot(workspaceRoot), sessionId);
}

function getSessionPath(workspaceRoot, sessionId) {
  return path.join(getArtifactDir(workspaceRoot, sessionId), "session.json");
}

function getArtifactPath(artifactDir, artifactName) {
  const spec = ARTIFACT_SPECS[artifactName];
  if (!spec) {
    throw artifactError(`unknown artifact type: ${artifactName}`);
  }
  return path.join(artifactDir, spec.filename);
}

function loadSchema(artifactName) {
  const spec = ARTIFACT_SPECS[artifactName];
  if (!spec) {
    throw artifactError(`unknown artifact schema: ${artifactName}`);
  }
  return readJson(path.join(pluginRoot, spec.schemaPath));
}

function validateValue(name, value, descriptor) {
  if (!descriptor) {
    return;
  }

  const expectedType = descriptor.type;
  if (expectedType === "array" && !Array.isArray(value)) {
    throw artifactError(`${name} must be an array`);
  }
  if (expectedType === "object" && (value == null || typeof value !== "object" || Array.isArray(value))) {
    throw artifactError(`${name} must be an object`);
  }
  if (expectedType && expectedType !== "array" && expectedType !== "object" && typeof value !== expectedType) {
    throw artifactError(`${name} must be a ${expectedType}`);
  }
  if (descriptor.const != null && value !== descriptor.const) {
    throw artifactError(`${name} must equal ${descriptor.const}`);
  }
  if (descriptor.enum && !descriptor.enum.includes(value)) {
    throw artifactError(`${name} must be one of ${descriptor.enum.join(", ")}`);
  }
}

function validateArtifactDocument(artifactName, document) {
  const schema = loadSchema(artifactName);

  for (const field of schema.required || []) {
    if (!(field in document)) {
      throw artifactError(`${artifactName} missing required field ${field}`, {
        artifact_type: artifactName,
        missing_field: field
      });
    }
  }

  for (const [field, descriptor] of Object.entries(schema.properties || {})) {
    if (field in document) {
      validateValue(field, document[field], descriptor);
    }
  }

  if (schema.payload_required) {
    const payload = document.payload;
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
      throw artifactError(`${artifactName} payload must be an object`, {
        artifact_type: artifactName
      });
    }
    for (const field of schema.payload_required) {
      if (!(field in payload)) {
        throw artifactError(`${artifactName} payload missing required field ${field}`, {
          artifact_type: artifactName,
          missing_field: field
        });
      }
    }
    for (const [field, descriptor] of Object.entries(schema.payload_properties || {})) {
      if (field in payload) {
        validateValue(`payload.${field}`, payload[field], descriptor);
      }
    }
  }

  if (schema.payload_item_required) {
    const payload = document.payload;
    if (!Array.isArray(payload)) {
      throw artifactError(`${artifactName} payload must be an array`, {
        artifact_type: artifactName
      });
    }
    for (const item of payload) {
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        throw artifactError(`${artifactName} payload items must be objects`, {
          artifact_type: artifactName
        });
      }
      for (const field of schema.payload_item_required) {
        if (!(field in item)) {
          throw artifactError(`${artifactName} payload item missing required field ${field}`, {
            artifact_type: artifactName,
            missing_field: field
          });
        }
      }
    }
  }
}

function buildArtifactDocument(artifactName, session, payload, options = {}) {
  return {
    schema: loadSchema(artifactName).schema_id,
    artifact_type: artifactName,
    session_id: session.session_id,
    route_id: options.route_id || session.route_id || null,
    phase: options.phase || session.current_phase || "session_initialized",
    generated_at: options.generated_at || new Date().toISOString(),
    payload
  };
}

function writeArtifact(session, artifactName, payload, options = {}) {
  const document = buildArtifactDocument(artifactName, session, payload, options);
  validateArtifactDocument(artifactName, document);
  const artifactPath = getArtifactPath(session.artifact_dir, artifactName);
  writeJson(artifactPath, document);
  return document;
}

function readArtifact(sessionOrDir, artifactName) {
  const artifactDir = typeof sessionOrDir === "string" ? sessionOrDir : sessionOrDir.artifact_dir;
  const artifactPath = getArtifactPath(artifactDir, artifactName);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  const document = readJson(artifactPath);
  validateArtifactDocument(artifactName, document);
  return document;
}

function listPresentArtifacts(sessionOrDir) {
  const artifactDir = typeof sessionOrDir === "string" ? sessionOrDir : sessionOrDir.artifact_dir;
  return Object.keys(ARTIFACT_SPECS).filter((artifactName) => fs.existsSync(getArtifactPath(artifactDir, artifactName)));
}

function getRequiredTerminalArtifacts(session) {
  const required = [...PRE_FLIGHT_ARTIFACTS];
  if (session.runtime_gate_status === "ready") {
    required.push("evidence_manifest");
    if ((session.required_gates || []).includes("review")) {
      required.push("review_decision");
    }
    if ((session.required_gates || []).includes("writeback")) {
      required.push("writeback_terminal");
    }
  }
  return required;
}

function buildArtifactPlan(session) {
  const files = {};
  for (const [artifactName, spec] of Object.entries(ARTIFACT_SPECS)) {
    files[artifactName] = getArtifactPath(session.artifact_dir, artifactName);
  }

  return {
    session_id: session.session_id,
    artifact_dir: session.artifact_dir,
    preflight_artifacts: PRE_FLIGHT_ARTIFACTS,
    terminal_artifacts: getRequiredTerminalArtifacts(session),
    files
  };
}

function deriveCurrentPhase(session) {
  const runtimeGate = readArtifact(session, "runtime_gate");
  const routeResolution = readArtifact(session, "route_resolution");
  const evidenceManifest = readArtifact(session, "evidence_manifest");
  const reviewDecision = readArtifact(session, "review_decision");
  const writebackReceipt = readArtifact(session, "writeback_receipt");
  const writebackDeclined = readArtifact(session, "writeback_declined");

  if (writebackReceipt || writebackDeclined) {
    return "completed";
  }

  if (runtimeGate?.payload?.status === "declined") {
    return "declined";
  }
  if (runtimeGate?.payload?.status === "blocked") {
    return "blocked";
  }
  if (runtimeGate?.payload?.status === "clarification_required") {
    return "clarification_required";
  }

  if (reviewDecision) {
    return "writeback_ready";
  }
  if (evidenceManifest) {
    return "review_active";
  }
  if (runtimeGate?.payload?.status === "ready") {
    return "gate_ready";
  }
  if (routeResolution?.payload?.route_status === "resolved") {
    return "route_resolved";
  }
  if (readArtifact(session, "task_profile")) {
    return "intake_accepted";
  }
  return "session_initialized";
}

function createRunSession(options) {
  const sessionId = options.session_id || createSessionId();
  const workspaceRoot = path.resolve(options.workspace_root || options.cwd || process.cwd());
  const artifactDir = getArtifactDir(workspaceRoot, sessionId);
  ensureDir(artifactDir);

  const session = {
    schema: "cutepower.run-session/v1",
    session_id: sessionId,
    workspace_root: workspaceRoot,
    artifact_dir: artifactDir,
    task_goal: options.task_goal || "",
    execution_mode: options.execution_mode || "default",
    explicit_mode: options.explicit_mode === true,
    route_id: options.route_id || null,
    required_gates: options.required_gates || [],
    writeback_level: options.writeback_level || null,
    runtime_gate_status: options.runtime_gate_status || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_phase: options.current_phase || "session_initialized",
    capability_secret: crypto.randomBytes(16).toString("hex"),
    last_capability: null
  };

  writeJson(getSessionPath(workspaceRoot, sessionId), session);
  session.artifact_plan = buildArtifactPlan(session);
  return session;
}

function loadRunSession(input) {
  if (!input) {
    throw artifactError("session input is required");
  }

  if (typeof input === "object" && input.session_id && input.artifact_dir) {
    return input;
  }

  let sessionPath = null;
  if (typeof input === "string" && input.endsWith("session.json")) {
    sessionPath = input;
  } else if (typeof input === "string") {
    sessionPath = path.join(input, "session.json");
  } else if (typeof input === "object" && input.workspace_root && input.session_id) {
    sessionPath = getSessionPath(input.workspace_root, input.session_id);
  }

  if (!sessionPath || !fs.existsSync(sessionPath)) {
    throw artifactError("run session does not exist", { input });
  }

  const session = readJson(sessionPath);
  session.artifact_plan = buildArtifactPlan(session);
  return session;
}

function saveRunSession(session) {
  session.updated_at = new Date().toISOString();
  session.current_phase = deriveCurrentPhase(session);
  session.artifact_plan = buildArtifactPlan(session);
  writeJson(getSessionPath(session.workspace_root, session.session_id), session);
  return session;
}

function syncRunSession(sessionInput) {
  const session = loadRunSession(sessionInput);
  return saveRunSession(session);
}

function issueSessionCapability(sessionInput, options = {}) {
  const session = loadRunSession(sessionInput);
  const phase = options.phase || deriveCurrentPhase(session);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (options.ttl_ms || 30 * 60 * 1000));
  const capability = {
    schema: "cutepower.session-capability/v1",
    capability_id: crypto.randomUUID(),
    capability_token: session.capability_secret,
    session_id: session.session_id,
    route_id: options.route_id || session.route_id || null,
    phase,
    allowed_actions: options.allowed_actions || [],
    artifact_dir: session.artifact_dir,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString()
  };
  session.last_capability = capability;
  saveRunSession(session);
  return capability;
}

function getRequiredArtifactsForPhase(phase) {
  switch (phase) {
    case "gate_ready":
    case "review_active":
    case "writeback_ready":
    case "completed":
      return [...PRE_FLIGHT_ARTIFACTS];
    case "route_resolved":
      return ["task_profile", "route_resolution"];
    case "intake_accepted":
      return ["task_profile"];
    default:
      return [];
  }
}

function validateCompletion(sessionInput) {
  const session = loadRunSession(sessionInput);
  const currentPhase = deriveCurrentPhase(session);
  const missing = [];

  for (const artifactName of getRequiredTerminalArtifacts(session)) {
    if (artifactName === "writeback_terminal") {
      if (!readArtifact(session, "writeback_receipt") && !readArtifact(session, "writeback_declined")) {
        missing.push("writeback_receipt|writeback_declined");
      }
      continue;
    }

    if (!readArtifact(session, artifactName)) {
      missing.push(artifactName);
    }
  }

  const terminalPhases = new Set(["completed", "declined", "blocked", "clarification_required"]);
  if (!terminalPhases.has(currentPhase)) {
    missing.push(`terminal_phase:${currentPhase}`);
  }

  return {
    ok: missing.length === 0,
    session_id: session.session_id,
    current_phase: currentPhase,
    missing
  };
}

function cliWriteArtifact(args) {
  const [sessionDir, artifactName, sourceFile] = args;
  if (!sessionDir || !artifactName || !sourceFile) {
    throw artifactError("usage: run-artifacts.js write <session_dir> <artifact_name> <json_file>");
  }
  const session = loadRunSession(sessionDir);
  const payload = readJson(path.resolve(sourceFile));
  writeArtifact(session, artifactName, payload, { phase: deriveCurrentPhase(session) });
  saveRunSession(session);
  return {
    ok: true,
    artifact_name: artifactName,
    artifact_path: getArtifactPath(session.artifact_dir, artifactName)
  };
}

function cliStatus(args) {
  const [sessionDir] = args;
  if (!sessionDir) {
    throw artifactError("usage: run-artifacts.js status <session_dir>");
  }
  const session = syncRunSession(sessionDir);
  return {
    ok: true,
    session_id: session.session_id,
    current_phase: session.current_phase,
    artifacts: listPresentArtifacts(session)
  };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  let result;

  switch (command) {
    case "status":
      result = cliStatus(args);
      break;
    case "write":
      result = cliWriteArtifact(args);
      break;
    default:
      throw artifactError("supported commands: status, write");
  }

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
  ARTIFACT_SPECS,
  PRE_FLIGHT_ARTIFACTS,
  buildArtifactPlan,
  createRunSession,
  deriveCurrentPhase,
  getArtifactDir,
  getArtifactPath,
  getRequiredArtifactsForPhase,
  getRequiredTerminalArtifacts,
  getSessionPath,
  issueSessionCapability,
  listPresentArtifacts,
  loadRunSession,
  readArtifact,
  saveRunSession,
  syncRunSession,
  validateArtifactDocument,
  validateCompletion,
  writeArtifact
};
