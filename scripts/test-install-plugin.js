#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const { run } = require("./install-plugin");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cutepower-install-"));
  const fakeHome = path.join(sandboxRoot, "home");
  const fakeRepoRoot = path.join(sandboxRoot, "repo");
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeRepoRoot, { recursive: true });

  fs.mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(fakeHome, ".codex", "config.toml"),
    'model = "gpt-5.4"\n[features]\nother_flag = true\n',
    "utf8"
  );
  fs.writeFileSync(
    path.join(fakeHome, ".codex", "hooks.json"),
    `${JSON.stringify(
      {
        hooks: {
          PostToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command: "echo existing-post-tool-hook"
                }
              ]
            }
          ]
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  fs.mkdirSync(path.join(fakeRepoRoot, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(fakeRepoRoot, ".codex", "config.toml"), "[features]\ncodex_hooks = false\n", "utf8");
  fs.writeFileSync(
    path.join(fakeRepoRoot, ".codex", "hooks.json"),
    `${JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "legacy",
              hooks: [
                {
                  type: "command",
                  command: "echo legacy-user-hook"
                }
              ]
            }
          ]
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  run(["--mode", "personal", "--home", fakeHome]);
  const personalPlugin = path.join(fakeHome, "plugins", "cutepower", ".codex-plugin", "plugin.json");
  const personalAgent = path.join(fakeHome, "plugins", "cutepower", "agents", "openai.yaml");
  const personalHostRuntime = path.join(fakeHome, "plugins", "cutepower", "scripts", "host-runtime.js");
  const personalCodexConfig = path.join(fakeHome, ".codex", "config.toml");
  const personalCodexHooks = path.join(fakeHome, ".codex", "hooks.json");
  const personalMarketplace = path.join(fakeHome, ".agents", "plugins", "marketplace.json");
  assert(fs.existsSync(personalPlugin), "personal install did not create plugin manifest");
  assert(fs.existsSync(personalAgent), "personal install did not copy runtime agent metadata");
  assert(fs.existsSync(personalHostRuntime), "personal install did not copy host runtime hook");
  assert(fs.existsSync(personalCodexConfig), "personal install did not write Codex config");
  assert(fs.existsSync(personalCodexHooks), "personal install did not write Codex hooks");
  assert(fs.existsSync(personalMarketplace), "personal install did not create marketplace");
  assert(
    readJson(personalPlugin).runtime.sessionContextHook.script === "scripts/host-runtime.js",
    "personal plugin manifest is missing host runtime hook metadata"
  );
  assert(
    fs.readFileSync(personalCodexConfig, "utf8").includes("codex_hooks = true"),
    "personal install did not enable codex hooks"
  );
  assert(
    fs.readFileSync(personalCodexConfig, "utf8").includes('model = "gpt-5.4"'),
    "personal install should preserve existing config values"
  );
  assert(
    fs.readFileSync(personalCodexConfig, "utf8").includes("other_flag = true"),
    "personal install should preserve other feature flags"
  );
  assert(
    readJson(personalCodexHooks).hooks.UserPromptSubmit[0].hooks[0].command.includes(path.join(fakeHome, "plugins", "cutepower", "scripts", "codex-hooks.js")),
    "personal hooks do not point at installed cutepower hook runner"
  );
  assert(
    readJson(personalCodexHooks).hooks.PostToolUse[0].hooks[0].command === "echo existing-post-tool-hook",
    "personal install should preserve unrelated existing hooks"
  );
  assert(
    readJson(personalMarketplace).plugins.find((plugin) => plugin.name === "cutepower").source.path === "./plugins/cutepower",
    "personal marketplace path is incorrect"
  );
  assert(
    readJson(personalMarketplace).plugins.find((plugin) => plugin.name === "cutepower").policy.installation === "AVAILABLE",
    "personal marketplace installation policy is incorrect"
  );

  run(["--mode", "repo", "--target-root", fakeRepoRoot]);
  const repoPlugin = path.join(fakeRepoRoot, "plugins", "cutepower", ".codex-plugin", "plugin.json");
  const repoAgent = path.join(fakeRepoRoot, "plugins", "cutepower", "agents", "openai.yaml");
  const repoHostRuntime = path.join(fakeRepoRoot, "plugins", "cutepower", "scripts", "host-runtime.js");
  const repoCodexConfig = path.join(fakeRepoRoot, ".codex", "config.toml");
  const repoCodexHooks = path.join(fakeRepoRoot, ".codex", "hooks.json");
  const repoMarketplace = path.join(fakeRepoRoot, ".agents", "plugins", "marketplace.json");
  assert(fs.existsSync(repoPlugin), "repo install did not create plugin manifest");
  assert(fs.existsSync(repoAgent), "repo install did not copy runtime agent metadata");
  assert(fs.existsSync(repoHostRuntime), "repo install did not copy host runtime hook");
  assert(fs.existsSync(repoCodexConfig), "repo install did not write Codex config");
  assert(fs.existsSync(repoCodexHooks), "repo install did not write Codex hooks");
  assert(fs.existsSync(repoMarketplace), "repo install did not create marketplace");
  assert(
    readJson(repoPlugin).runtime.sessionContextHook.script === "scripts/host-runtime.js",
    "repo plugin manifest is missing host runtime hook metadata"
  );
  assert(
    fs.readFileSync(repoCodexConfig, "utf8").includes("codex_hooks = true"),
    "repo install did not enable codex hooks"
  );
  assert(
    readJson(repoCodexHooks).hooks.UserPromptSubmit.some((entry) =>
      JSON.stringify(entry.hooks || []).includes("legacy-user-hook")
    ),
    "repo install should preserve existing UserPromptSubmit hooks"
  );
  assert(
    readJson(repoCodexHooks).hooks.PreToolUse[0].hooks[0].command.includes(path.join(fakeRepoRoot, "plugins", "cutepower", "scripts", "codex-hooks.js")),
    "repo hooks do not point at installed cutepower hook runner"
  );
  assert(
    readJson(repoMarketplace).plugins.find((plugin) => plugin.name === "cutepower").source.path === "./plugins/cutepower",
    "repo marketplace path is incorrect"
  );
  assert(
    readJson(repoMarketplace).plugins.find((plugin) => plugin.name === "cutepower").policy.installation === "AVAILABLE",
    "repo marketplace installation policy is incorrect"
  );

  run(["--mode", "personal", "--home", fakeHome, "--force"]);
  const personalHooksAfterReinstall = readJson(personalCodexHooks);
  const personalCutepowerUserHooks = personalHooksAfterReinstall.hooks.UserPromptSubmit.filter((entry) =>
    JSON.stringify(entry.hooks || []).includes(path.join(fakeHome, "plugins", "cutepower", "scripts", "codex-hooks.js"))
  );
  assert(personalCutepowerUserHooks.length === 1, "reinstall should not duplicate cutepower UserPromptSubmit hooks");

  run(["--mode", "repo", "--target-root", fakeRepoRoot, "--force"]);
  const repoHooksAfterReinstall = readJson(repoCodexHooks);
  const repoCutepowerPreToolHooks = repoHooksAfterReinstall.hooks.PreToolUse.filter((entry) =>
    JSON.stringify(entry.hooks || []).includes(path.join(fakeRepoRoot, "plugins", "cutepower", "scripts", "codex-hooks.js"))
  );
  assert(repoCutepowerPreToolHooks.length === 1, "reinstall should not duplicate cutepower PreToolUse hooks");

  console.log("cutepower install tests passed");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
