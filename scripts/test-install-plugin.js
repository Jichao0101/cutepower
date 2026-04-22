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

  run(["--mode", "personal", "--home", fakeHome]);
  const personalPlugin = path.join(fakeHome, "plugins", "cutepower", ".codex-plugin", "plugin.json");
  const personalAgent = path.join(fakeHome, "plugins", "cutepower", "agents", "openai.yaml");
  const personalHostRuntime = path.join(fakeHome, "plugins", "cutepower", "scripts", "host-runtime.js");
  const personalMarketplace = path.join(fakeHome, ".agents", "plugins", "marketplace.json");
  assert(fs.existsSync(personalPlugin), "personal install did not create plugin manifest");
  assert(fs.existsSync(personalAgent), "personal install did not copy runtime agent metadata");
  assert(fs.existsSync(personalHostRuntime), "personal install did not copy host runtime hook");
  assert(fs.existsSync(personalMarketplace), "personal install did not create marketplace");
  assert(
    readJson(personalPlugin).runtime.sessionContextHook.script === "scripts/host-runtime.js",
    "personal plugin manifest is missing host runtime hook metadata"
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
  const repoMarketplace = path.join(fakeRepoRoot, ".agents", "plugins", "marketplace.json");
  assert(fs.existsSync(repoPlugin), "repo install did not create plugin manifest");
  assert(fs.existsSync(repoAgent), "repo install did not copy runtime agent metadata");
  assert(fs.existsSync(repoHostRuntime), "repo install did not copy host runtime hook");
  assert(fs.existsSync(repoMarketplace), "repo install did not create marketplace");
  assert(
    readJson(repoPlugin).runtime.sessionContextHook.script === "scripts/host-runtime.js",
    "repo plugin manifest is missing host runtime hook metadata"
  );
  assert(
    readJson(repoMarketplace).plugins.find((plugin) => plugin.name === "cutepower").source.path === "./plugins/cutepower",
    "repo marketplace path is incorrect"
  );
  assert(
    readJson(repoMarketplace).plugins.find((plugin) => plugin.name === "cutepower").policy.installation === "AVAILABLE",
    "repo marketplace installation policy is incorrect"
  );

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
