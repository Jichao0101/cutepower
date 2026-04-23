#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { getManifestPath, writeInstallManifest } = require("./install-manifest");

const repoRoot = path.resolve(__dirname, "..");
const pluginName = "cutepower";

const RUNTIME_PATHS = [
  ".codex-plugin",
  ".codex/INSTALL.md",
  "AGENTS.md",
  "README.codex.md",
  "README.md",
  "agents",
  "contracts",
  "schemas",
  "scripts",
  "skills"
];

function usage() {
  console.log(`Usage:
  node scripts/install-plugin.js --mode personal [--home <dir>] [--force]
  node scripts/install-plugin.js --mode repo --target-root <repo-root> [--force]

Options:
  --mode <personal|repo>   Install into a user home or a repo-local plugin root.
  --home <dir>             Home directory to use for personal install. Defaults to $HOME.
  --target-root <dir>      Repo root to use for repo install.
  --force                  Replace an existing installed copy.
  --no-marketplace         Skip marketplace.json creation/update.
`);
}

function parseArgs(argv) {
  const options = {
    mode: null,
    home: os.homedir(),
    targetRoot: null,
    force: false,
    noMarketplace: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      options.mode = argv[++index] || null;
    } else if (arg === "--home") {
      options.home = argv[++index] || null;
    } else if (arg === "--target-root") {
      options.targetRoot = argv[++index] || null;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--no-marketplace") {
      options.noMarketplace = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.mode || !["personal", "repo"].includes(options.mode)) {
    throw new Error("Missing or invalid --mode. Use personal or repo.");
  }

  if (options.mode === "repo" && !options.targetRoot) {
    throw new Error("--target-root is required for repo installs.");
  }

  return options;
}

function resolveLayout(options) {
  if (options.mode === "personal") {
    const homeRoot = path.resolve(options.home);
    return {
      installRoot: homeRoot,
      installDir: path.join(homeRoot, ".codex", "plugins", pluginName),
      marketplacePath: path.join(homeRoot, ".agents", "plugins", "marketplace.json"),
      codexConfigPath: path.join(homeRoot, ".codex", "config.toml"),
      codexHooksPath: path.join(homeRoot, ".codex", "hooks.json"),
      marketplaceName: "personal-local",
      marketplaceDisplayName: "Personal Local",
      sourcePath: `./.codex/plugins/${pluginName}`
    };
  }

  const repoInstallRoot = path.resolve(options.targetRoot);
  return {
    installRoot: repoInstallRoot,
    installDir: path.join(repoInstallRoot, "plugins", pluginName),
    marketplacePath: path.join(repoInstallRoot, ".agents", "plugins", "marketplace.json"),
    codexConfigPath: path.join(repoInstallRoot, ".codex", "config.toml"),
    codexHooksPath: path.join(repoInstallRoot, ".codex", "hooks.json"),
    marketplaceName: path.basename(repoInstallRoot) || "repo-local",
    marketplaceDisplayName: `${path.basename(repoInstallRoot) || "Repo"} Local`,
    sourcePath: `./plugins/${pluginName}`
  };
}

function ensurePluginManifest() {
  const manifestPath = path.join(repoRoot, ".codex-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing plugin manifest: ${manifestPath}`);
  }
}

function ensurePathSeparated(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === repoRoot) {
    throw new Error("Install target resolves to the development repository root. Use a dedicated install path.");
  }
  if (resolvedTarget.startsWith(`${repoRoot}${path.sep}`)) {
    const relative = path.relative(repoRoot, resolvedTarget);
    if (!relative.startsWith("plugins" + path.sep) && !relative.startsWith(".agents" + path.sep)) {
      throw new Error(`Install target must not nest inside the development tree: ${resolvedTarget}`);
    }
  }
}

function removeDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyEntry(sourcePath, targetPath) {
  const stats = fs.lstatSync(sourcePath);
  if (stats.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyEntry(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function installRuntime(layout, options) {
  ensurePathSeparated(layout.installDir);

  if (fs.existsSync(layout.installDir)) {
    if (!options.force) {
      throw new Error(`Install target already exists: ${layout.installDir}. Re-run with --force to replace it.`);
    }
    removeDir(layout.installDir);
  }

  fs.mkdirSync(layout.installDir, { recursive: true });
  for (const relativePath of RUNTIME_PATHS) {
    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(layout.installDir, relativePath);
    copyEntry(sourcePath, targetPath);
  }
}

function writeMarketplace(layout) {
  fs.mkdirSync(path.dirname(layout.marketplacePath), { recursive: true });

  let marketplace = {
    name: layout.marketplaceName,
    interface: {
      displayName: layout.marketplaceDisplayName
    },
    plugins: []
  };

  if (fs.existsSync(layout.marketplacePath)) {
    marketplace = JSON.parse(fs.readFileSync(layout.marketplacePath, "utf8"));
    if (!marketplace.plugins || !Array.isArray(marketplace.plugins)) {
      throw new Error(`Invalid marketplace file: ${layout.marketplacePath}`);
    }
    if (!marketplace.name) {
      marketplace.name = layout.marketplaceName;
    }
    if (!marketplace.interface || typeof marketplace.interface !== "object") {
      marketplace.interface = { displayName: layout.marketplaceDisplayName };
    } else if (!marketplace.interface.displayName) {
      marketplace.interface.displayName = layout.marketplaceDisplayName;
    }
  }

  const entry = {
    name: pluginName,
    source: {
      source: "local",
      path: layout.sourcePath
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL"
    },
    category: "Productivity"
  };

  const nextPlugins = marketplace.plugins.filter((plugin) => plugin.name !== pluginName);
  nextPlugins.push(entry);
  marketplace.plugins = nextPlugins;

  fs.writeFileSync(layout.marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
  return [
    {
      file: layout.marketplacePath,
      key: pluginName,
      value: entry
    }
  ];
}

function ensureCodexHooksFeature(configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, "[features]\ncodex_hooks = true\n", "utf8");
    return [
      {
        file: configPath,
        path: "features.codex_hooks",
        value: true,
        change_type: "create_file_with_feature",
        previous_state: "missing"
      }
    ];
  }

  const current = fs.readFileSync(configPath, "utf8");
  if (/\bcodex_hooks\s*=/.test(current)) {
    if (/\bcodex_hooks\s*=\s*false\b/.test(current)) {
      fs.writeFileSync(configPath, current.replace(/\bcodex_hooks\s*=\s*false\b/, "codex_hooks = true"), "utf8");
      return [
        {
          file: configPath,
          path: "features.codex_hooks",
          value: true,
          change_type: "replace_false_with_true",
          previous_state: false
        }
      ];
    }
    return [];
  }

  if (/\[features\]/.test(current)) {
    fs.writeFileSync(configPath, current.replace(/\[features\]\s*/m, "[features]\ncodex_hooks = true\n"), "utf8");
    return [
      {
        file: configPath,
        path: "features.codex_hooks",
        value: true,
        change_type: "insert_under_existing_features",
        previous_state: "missing"
      }
    ];
  }

  const suffix = current.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(configPath, `${current}${suffix}\n[features]\ncodex_hooks = true\n`, "utf8");
  return [
    {
      file: configPath,
      path: "features.codex_hooks",
      value: true,
      change_type: "append_features_section",
      previous_state: "missing"
    }
  ];
}

function readHooksFile(hooksPath) {
  if (!fs.existsSync(hooksPath)) {
    return { hooks: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  if (!parsed.hooks || typeof parsed.hooks !== "object") {
    parsed.hooks = {};
  }
  return parsed;
}

function buildHookEntries(layout) {
  const hookRunner = `node "${path.join(layout.installDir, "scripts", "codex-hooks.js")}"`;
  return {
    UserPromptSubmit: [
      {
        matcher: ".*",
        hooks: [
          {
            type: "command",
            command: `${hookRunner} user-prompt-submit`
          }
        ]
      }
    ],
    PreToolUse: [
      {
        matcher: "Read|Open|Grep|Glob|Search|List|View|Bash|Shell|functions.exec_command|Edit|Write|MultiEdit|ApplyPatch|functions.apply_patch",
        hooks: [
          {
            type: "command",
            command: `${hookRunner} pre-tool-use`
          }
        ]
      }
    ],
    Stop: [
      {
        matcher: ".*",
        hooks: [
          {
            type: "command",
            command: `${hookRunner} stop`
          }
        ]
      }
    ]
  };
}

function mergeHooks(layout) {
  fs.mkdirSync(path.dirname(layout.codexHooksPath), { recursive: true });
  const current = readHooksFile(layout.codexHooksPath);
  const desired = buildHookEntries(layout);
  const registrations = [];

  for (const [eventName, entries] of Object.entries(desired)) {
    const existingEntries = Array.isArray(current.hooks[eventName]) ? current.hooks[eventName] : [];
    for (const entry of entries) {
      for (const hook of entry.hooks || []) {
        registrations.push({
          file: layout.codexHooksPath,
          event: eventName,
          matcher: entry.matcher || null,
          command: hook.command
        });
      }
      const exists = existingEntries.some(
        (candidate) =>
          candidate.matcher === entry.matcher &&
          JSON.stringify(candidate.hooks || []) === JSON.stringify(entry.hooks || [])
      );
      if (!exists) {
        existingEntries.push(entry);
      }
    }
    current.hooks[eventName] = existingEntries;
  }

  fs.writeFileSync(layout.codexHooksPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  return registrations;
}

function detectSource() {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const status = spawnSync("git", ["status", "--short"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  return {
    repo: repoRoot,
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    dirty: status.status === 0 ? status.stdout.trim().length > 0 : null
  };
}

function buildInstallManifest(layout, options, writes) {
  return {
    plugin_name: pluginName,
    install_mode: options.mode,
    installed_plugin_path: layout.installDir,
    manifest_path: getManifestPath(layout),
    marketplace_entries: writes.marketplaceEntries,
    hook_registrations: writes.hookRegistrations,
    config_changes: writes.configChanges,
    installed_at: new Date().toISOString(),
    source: detectSource()
  };
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  ensurePluginManifest();
  const layout = resolveLayout(options);
  installRuntime(layout, options);
  const configChanges = ensureCodexHooksFeature(layout.codexConfigPath);
  const hookRegistrations = mergeHooks(layout);
  let marketplaceEntries = [];
  if (!options.noMarketplace) {
    marketplaceEntries = writeMarketplace(layout);
  }
  const manifest = buildInstallManifest(layout, options, {
    marketplaceEntries,
    hookRegistrations,
    configChanges
  });
  writeInstallManifest(layout, manifest);

  console.log(`Installed ${pluginName}`);
  console.log(`  mode: ${options.mode}`);
  console.log(`  installDir: ${layout.installDir}`);
  console.log(`  manifest: ${getManifestPath(layout)}`);
  console.log(`  codex config: ${layout.codexConfigPath}`);
  console.log(`  codex hooks: ${layout.codexHooksPath}`);
  if (!options.noMarketplace) {
    console.log(`  marketplace: ${layout.marketplacePath}`);
    console.log(`  marketplace source.path: ${layout.sourcePath}`);
  }
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  RUNTIME_PATHS,
  buildHookEntries,
  ensureCodexHooksFeature,
  buildInstallManifest,
  mergeHooks,
  parseArgs,
  resolveLayout,
  run
};
