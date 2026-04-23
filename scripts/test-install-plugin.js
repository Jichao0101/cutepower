#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const { run } = require("./install-plugin");
const { MANIFEST_FILE } = require("./install-manifest");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const LEGACY_RUNTIME_CONFIG_FILE = ["ho", "oks", "json"].join(".");

function main() {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cutepower-install-"));
  const fakeHome = path.join(sandboxRoot, "home");
  const fakeRepoRoot = path.join(sandboxRoot, "repo");
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeRepoRoot, { recursive: true });

  run(["--mode", "personal", "--home", fakeHome]);
  const personalPlugin = path.join(fakeHome, ".codex", "plugins", "cutepower", ".codex-plugin", "plugin.json");
  const personalAgent = path.join(fakeHome, ".codex", "plugins", "cutepower", "agents", "openai.yaml");
  const personalHostRuntime = path.join(fakeHome, ".codex", "plugins", "cutepower", "scripts", "host-runtime.js");
  const personalMarketplace = path.join(fakeHome, ".agents", "plugins", "marketplace.json");
  const personalInstallManifest = path.join(fakeHome, ".codex", "plugins", "cutepower", MANIFEST_FILE);
  const personalManifest = readJson(personalInstallManifest);
  assert(fs.existsSync(personalPlugin), "personal install did not create plugin manifest");
  assert(fs.existsSync(personalAgent), "personal install did not copy runtime agent metadata");
  assert(fs.existsSync(personalHostRuntime), "personal install did not copy host runtime asset");
  assert(fs.existsSync(personalMarketplace), "personal install did not create marketplace");
  assert(fs.existsSync(personalInstallManifest), "personal install did not create install manifest");
  assert(
    !Object.prototype.hasOwnProperty.call(readJson(personalPlugin), "runtime"),
    "personal plugin manifest should not carry legacy runtime metadata"
  );
  assert(
    readJson(personalMarketplace).plugins.find((plugin) => plugin.name === "cutepower").source.path === "./.codex/plugins/cutepower",
    "personal marketplace path is incorrect"
  );
  assert(
    readJson(personalMarketplace).plugins.find((plugin) => plugin.name === "cutepower").policy.installation === "AVAILABLE",
    "personal marketplace installation policy is incorrect"
  );
  assert(personalManifest.install_mode === "personal", "personal manifest should record install_mode=personal");
  assert(
    !Object.prototype.hasOwnProperty.call(personalManifest, "hook_registrations"),
    "personal manifest should not record legacy runtime registrations"
  );
  assert(
    !Object.prototype.hasOwnProperty.call(personalManifest, "config_changes"),
    "personal manifest should not record legacy runtime config changes"
  );
  assert(
    personalManifest.marketplace_entries[0].file === personalMarketplace,
    "personal manifest should record marketplace file"
  );
  assert(
    !fs.existsSync(path.join(fakeHome, ".codex", LEGACY_RUNTIME_CONFIG_FILE)),
    "personal install should not create legacy runtime config files"
  );

  run(["--mode", "repo", "--target-root", fakeRepoRoot]);
  const repoPlugin = path.join(fakeRepoRoot, "plugins", "cutepower", ".codex-plugin", "plugin.json");
  const repoAgent = path.join(fakeRepoRoot, "plugins", "cutepower", "agents", "openai.yaml");
  const repoHostRuntime = path.join(fakeRepoRoot, "plugins", "cutepower", "scripts", "host-runtime.js");
  const repoMarketplace = path.join(fakeRepoRoot, ".agents", "plugins", "marketplace.json");
  const repoInstallManifest = path.join(fakeRepoRoot, "plugins", "cutepower", MANIFEST_FILE);
  const repoManifest = readJson(repoInstallManifest);
  assert(fs.existsSync(repoPlugin), "repo install did not create plugin manifest");
  assert(fs.existsSync(repoAgent), "repo install did not copy runtime agent metadata");
  assert(fs.existsSync(repoHostRuntime), "repo install did not copy host runtime asset");
  assert(fs.existsSync(repoMarketplace), "repo install did not create marketplace");
  assert(fs.existsSync(repoInstallManifest), "repo install did not create install manifest");
  assert(
    !Object.prototype.hasOwnProperty.call(readJson(repoPlugin), "runtime"),
    "repo plugin manifest should not carry legacy runtime metadata"
  );
  assert(
    readJson(repoMarketplace).plugins.find((plugin) => plugin.name === "cutepower").source.path === "./plugins/cutepower",
    "repo marketplace path is incorrect"
  );
  assert(
    readJson(repoMarketplace).plugins.find((plugin) => plugin.name === "cutepower").policy.installation === "AVAILABLE",
    "repo marketplace installation policy is incorrect"
  );
  assert(repoManifest.install_mode === "repo", "repo manifest should record install_mode=repo");
  assert(
    !Object.prototype.hasOwnProperty.call(repoManifest, "hook_registrations"),
    "repo manifest should not record legacy runtime registrations"
  );
  assert(
    !Object.prototype.hasOwnProperty.call(repoManifest, "config_changes"),
    "repo manifest should not record legacy runtime config changes"
  );
  assert(
    !fs.existsSync(path.join(fakeRepoRoot, ".codex", LEGACY_RUNTIME_CONFIG_FILE)),
    "repo install should not create legacy runtime config files"
  );

  run(["--mode", "personal", "--home", fakeHome, "--force"]);
  assert(fs.existsSync(personalPlugin), "personal reinstall should preserve staged plugin copy");

  run(["--mode", "repo", "--target-root", fakeRepoRoot, "--force"]);
  assert(fs.existsSync(repoPlugin), "repo reinstall should preserve staged plugin copy");

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
