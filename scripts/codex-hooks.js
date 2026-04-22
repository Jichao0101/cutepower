#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  deriveCurrentPhase,
  issueSessionCapability,
  loadRunSession,
  validateCompletion
} = require("./run-artifacts");
const { buildSessionContextEnvelope } = require("./host-runtime");
const { evaluateRuntimeRequest, validateRunCompletion } = require("./runtime-gates");

const pluginRoot = path.resolve(__dirname, "..");

function getWorkspaceRoot() {
  return process.env.CODEX_WORKSPACE_ROOT || process.cwd();
}

function getHookStateDir() {
  const workspaceRoot = getWorkspaceRoot();
  return path.join(os.tmpdir(), `cutepower-hook-state-${Buffer.from(workspaceRoot).toString("hex").slice(0, 24)}`);
}

function getHookStatePath() {
  return path.join(getHookStateDir(), "cutepower-state.json");
}

function getPluginRuntimePaths() {
  return [
    path.join(pluginRoot, ".codex").replace(/\\/g, "/"),
    path.join(pluginRoot, ".agents").replace(/\\/g, "/"),
    path.join(pluginRoot, ".codex-plugin").replace(/\\/g, "/"),
    path.join(pluginRoot, "agents").replace(/\\/g, "/"),
    path.join(pluginRoot, "contracts").replace(/\\/g, "/"),
    path.join(pluginRoot, "scripts", "host-runtime.js").replace(/\\/g, "/"),
    path.join(pluginRoot, "scripts", "task-intake.js").replace(/\\/g, "/"),
    path.join(pluginRoot, "scripts", "runtime-gates.js").replace(/\\/g, "/")
  ];
}

const hookStateDir = getHookStateDir();
const hookStatePath = path.join(hookStateDir, "cutepower-state.json");

function hookError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

function readJsonText(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

async function readHookPayload() {
  for (const envKey of ["CODEX_HOOK_PAYLOAD", "CODEX_HOOK_INPUT", "CODEX_HOOK_EVENT"]) {
    const parsed = readJsonText(process.env[envKey]);
    if (parsed) {
      return parsed;
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => finish({}), 50);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      finish(readJsonText(buffer.trim()) || {});
    });
    process.stdin.on("error", () => {
      finish({});
    });

    process.stdin.resume();
    if (process.stdin.isTTY) {
      finish({});
    }
  });
}

function ensureStateDir() {
  fs.mkdirSync(hookStateDir, { recursive: true });
}

function readState() {
  const statePath = getHookStatePath();
  if (!fs.existsSync(hookStatePath)) {
    return {
      explicit_mode: false,
      denied_events: [],
      unmapped_events: []
    };
  }

  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function writeState(state) {
  const statePath = getHookStatePath();
  ensureStateDir();
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function getNestedString(payload, candidates) {
  for (const candidate of candidates) {
    const segments = candidate.split(".");
    let current = payload;
    let found = true;
    for (const segment of segments) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        found = false;
        break;
      }
      current = current[segment];
    }
    if (found && typeof current === "string" && current.trim()) {
      return current;
    }
  }
  return "";
}

function getNestedValue(payload, candidates) {
  for (const candidate of candidates) {
    const segments = candidate.split(".");
    let current = payload;
    let found = true;
    for (const segment of segments) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        found = false;
        break;
      }
      current = current[segment];
    }
    if (found && current != null) {
      return current;
    }
  }
  return null;
}

function extractPrompt(payload) {
  return getNestedString(payload, [
    "prompt",
    "user_prompt",
    "text",
    "message",
    "input",
    "payload.prompt",
    "payload.user_prompt",
    "payload.text",
    "payload.message"
  ]);
}

function extractToolName(payload) {
  return getNestedString(payload, [
    "tool_name",
    "tool.name",
    "tool",
    "matcher",
    "payload.tool_name",
    "payload.tool.name",
    "payload.tool"
  ]);
}

function extractCommand(payload) {
  const direct = getNestedString(payload, [
    "command",
    "tool_input.command",
    "tool_input.cmd",
    "input.command",
    "input.cmd",
    "arguments.command",
    "arguments.cmd",
    "payload.command",
    "payload.tool_input.command",
    "payload.tool_input.cmd"
  ]);

  if (direct) {
    return direct;
  }

  const listValue = getNestedValue(payload, ["command", "payload.command"]);
  if (Array.isArray(listValue)) {
    return listValue.join(" ");
  }

  return "";
}

function extractPaths(payload) {
  const values = [];
  for (const key of [
    "path",
    "file_path",
    "tool_input.path",
    "input.path",
    "payload.path",
    "payload.tool_input.path"
  ]) {
    const value = getNestedValue(payload, [key]);
    if (typeof value === "string" && value.trim()) {
      values.push(value);
    }
  }
  return values;
}

function isRuntimePath(candidatePath) {
  const normalized = String(candidatePath || "").replace(/\\/g, "/");
  return getPluginRuntimePaths().some((runtimePath) => normalized.includes(runtimePath));
}

function inferReadAction(command, paths) {
  if (paths.some((entry) => isRuntimePath(entry))) {
    return "runtime_discovery_read";
  }

  const runtimeMarkers = [".codex", ".agents", ".codex-plugin", "host-runtime.js", "task-intake.js", "runtime-gates.js"];
  if (runtimeMarkers.some((marker) => command.includes(marker))) {
    return "runtime_discovery_read";
  }

  return "business_context_read";
}

function inferActionFromHookPayload(payload) {
  if (payload.cutepower_request && typeof payload.cutepower_request === "object") {
    return {
      mode: "direct",
      request: payload.cutepower_request
    };
  }

  const toolName = extractToolName(payload);
  const command = extractCommand(payload);
  const paths = extractPaths(payload);
  const readLike = /(Read|Open|Grep|Glob|Search|List|View)/i.test(toolName);
  const writeLike = /(Edit|Write|MultiEdit|ApplyPatch)/i.test(toolName);
  const shellLike = /(Bash|Shell|functions\.exec_command)/i.test(toolName);

  if (readLike) {
    return {
      mode: "inferred",
      request: {
        request_type: "skill_invocation",
        skill_id: "using-cutepower",
        role_id: "workflow-orchestrator",
        requested_actions: [inferReadAction(command, paths)]
      }
    };
  }

  if (writeLike) {
    return {
      mode: "inferred",
      request: {
        request_type: "skill_invocation",
        skill_id: "cute-repo-change",
        role_id: "repo-coder",
        state: "implementation",
        requested_actions: ["repo_write"]
      }
    };
  }

  if (shellLike) {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) {
      return null;
    }

    if (/^(cat|sed|rg|find|ls|nl|wc)\b/.test(normalizedCommand)) {
      return {
        mode: "inferred",
        request: {
          request_type: "skill_invocation",
          skill_id: "using-cutepower",
          role_id: "workflow-orchestrator",
          requested_actions: [inferReadAction(normalizedCommand, paths)]
        }
      };
    }

    if (/apply_patch|git apply|patch\b|^mv\b|^cp\b/.test(normalizedCommand)) {
      return {
        mode: "inferred",
        request: {
          request_type: "skill_invocation",
          skill_id: "cute-repo-change",
          role_id: "repo-coder",
          state: "implementation",
          requested_actions: ["repo_write"]
        }
      };
    }
  }

  return null;
}

function mergeGuard(request, state) {
  return {
    ...request,
    ...(state.action_guard || {})
  };
}

function inferGateStateForRequest(request, session) {
  if (request.request_type === "review_decision") {
    return "review";
  }
  if (request.request_type === "writeback") {
    return "writeback";
  }

  const actions = request.requested_actions || [];
  if (actions.includes("repo_write") || actions.includes("verification_write") || actions.includes("board_execute")) {
    return "implementation";
  }

  if (deriveCurrentPhase(session) === "review_active") {
    return "review";
  }

  return "analysis";
}

function attachDerivedCapability(request, state) {
  const actions = Array.isArray(request.requested_actions)
    ? request.requested_actions
    : request.request_type === "writeback"
      ? [request.writeback_level]
      : [];

  const runtimeDiscoveryOnly = actions.length > 0 && actions.every((action) => action === "runtime_discovery_read");
  if (runtimeDiscoveryOnly) {
    return request;
  }

  const artifactDir = request.artifact_dir || state.action_guard?.artifact_dir;
  if (!artifactDir) {
    throw hookError("explicit mode request is missing artifact_dir");
  }

  const session = loadRunSession(artifactDir);
  const phase = deriveCurrentPhase(session);
  const capability = request.session_capability || issueSessionCapability(session, {
    phase,
    allowed_actions: actions,
    route_id: request.route_id || session.route_id
  });

  return {
    ...request,
    route_id: request.route_id || session.route_id,
    artifact_dir: artifactDir,
    state: request.state || inferGateStateForRequest(request, session),
    session_capability: capability
  };
}

function handleUserPromptSubmit(payload) {
  const prompt = extractPrompt(payload);
  if (!prompt) {
    return "";
  }

  const envelope = buildSessionContextEnvelope({
    task_goal: prompt,
    cwd: getWorkspaceRoot()
  });

  const nextState = {
    ...readState(),
    updated_at: new Date().toISOString(),
    last_prompt: prompt,
    explicit_mode: envelope.host_runtime.explicit_mode === true,
    intake_package: envelope.intake_package,
    action_guard: envelope.host_runtime.action_guard,
    session_context: envelope.host_runtime.session_context,
    session_capability: envelope.host_runtime.session_capability,
    denied_events: [],
    unmapped_events: []
  };
  writeState(nextState);

  if (!nextState.explicit_mode) {
    return "";
  }

  return [
    "[cutepower hook] explicit cutepower mode is active",
    ...nextState.session_context.warning_lines,
    `[cutepower hook] required preflight outputs: ${nextState.session_context.required_preflight_outputs.join(", ")}`
  ].join("\n");
}

function handlePreToolUse(payload) {
  const state = readState();
  if (!state.explicit_mode) {
    return "";
  }

  const inferred = inferActionFromHookPayload(payload);
  if (!inferred) {
    const deniedEvent = {
      at: new Date().toISOString(),
      tool_name: extractToolName(payload),
      command: extractCommand(payload),
      error: "unmapped tool event denied in explicit cutepower mode"
    };
    state.unmapped_events.push(deniedEvent);
    state.denied_events.push(deniedEvent);
    writeState(state);
    throw hookError("unmapped tool event denied in explicit cutepower mode");
  }

  const request = attachDerivedCapability(mergeGuard(inferred.request, state), state);

  try {
    evaluateRuntimeRequest(request);
  } catch (error) {
    state.denied_events.push({
      at: new Date().toISOString(),
      tool_name: extractToolName(payload),
      command: extractCommand(payload),
      request,
      error: error.message
    });
    writeState(state);
    throw error;
  }

  return "";
}

function handleStop() {
  const state = readState();
  if (!state.explicit_mode) {
    return "";
  }

  const completion = validateRunCompletion(state.action_guard?.artifact_dir);
  if (!completion.ok) {
    throw hookError(`explicit cutepower run is not closed: ${completion.missing.join(", ")}`, completion);
  }

  const denied = state.denied_events || [];
  const unmapped = state.unmapped_events || [];
  return [
    "[cutepower hook] stop summary",
    `[cutepower hook] explicit mode: ${state.explicit_mode}`,
    `[cutepower hook] phase: ${completion.current_phase}`,
    `[cutepower hook] denied events: ${denied.length}`,
    `[cutepower hook] unmapped tool events: ${unmapped.length}`
  ].join("\n");
}

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    throw hookError("hook mode is required");
  }

  const payload = await readHookPayload();
  let output = "";

  if (mode === "user-prompt-submit") {
    output = handleUserPromptSubmit(payload);
  } else if (mode === "pre-tool-use") {
    output = handlePreToolUse(payload);
  } else if (mode === "stop") {
    output = handleStop(payload);
  } else {
    throw hookError(`unsupported hook mode: ${mode}`);
  }

  if (output) {
    console.log(output);
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (error.message) {
      console.error(error.message);
    }
    process.exit(2);
  });
}
