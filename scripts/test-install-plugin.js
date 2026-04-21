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
  const personalPlugin = path.join(fakeHome, ".codex", "plugins", "cutepower", ".codex-plugin", "plugin.json");
  const personalAgent = path.join(fakeHome, ".codex", "plugins", "cutepower", "agents", "openai.yaml");
  const personalMarketplace = path.join(fakeHome, ".agents", "plugins", "marketplace.json");
  assert(fs.existsSync(personalPlugin), "personal install did not create plugin manifest");
  assert(fs.existsSync(personalAgent), "personal install did not copy runtime agent metadata");
  assert(fs.existsSync(personalMarketplace), "personal install did not create marketplace");
  assert(
    readJson(personalMarketplace).plugins.find((plugin) => plugin.name === "cutepower").source.path === "./.codex/plugins/cutepower",
    "personal marketplace path is incorrect"
  );

  run(["--mode", "repo", "--target-root", fakeRepoRoot]);
  const repoPlugin = path.join(fakeRepoRoot, "plugins", "cutepower", ".codex-plugin", "plugin.json");
  const repoAgent = path.join(fakeRepoRoot, "plugins", "cutepower", "agents", "openai.yaml");
  const repoMarketplace = path.join(fakeRepoRoot, ".agents", "plugins", "marketplace.json");
  assert(fs.existsSync(repoPlugin), "repo install did not create plugin manifest");
  assert(fs.existsSync(repoAgent), "repo install did not copy runtime agent metadata");
  assert(fs.existsSync(repoMarketplace), "repo install did not create marketplace");
  assert(
    readJson(repoMarketplace).plugins.find((plugin) => plugin.name === "cutepower").source.path === "./plugins/cutepower",
    "repo marketplace path is incorrect"
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
