#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

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
      installDir: path.join(homeRoot, "plugins", pluginName),
      marketplacePath: path.join(homeRoot, ".agents", "plugins", "marketplace.json"),
      marketplaceName: "personal-local",
      marketplaceDisplayName: "Personal Local",
      sourcePath: `./plugins/${pluginName}`
    };
  }

  const repoInstallRoot = path.resolve(options.targetRoot);
  return {
    installRoot: repoInstallRoot,
    installDir: path.join(repoInstallRoot, "plugins", pluginName),
    marketplacePath: path.join(repoInstallRoot, ".agents", "plugins", "marketplace.json"),
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
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  ensurePluginManifest();
  const layout = resolveLayout(options);
  installRuntime(layout, options);
  if (!options.noMarketplace) {
    writeMarketplace(layout);
  }

  console.log(`Installed ${pluginName}`);
  console.log(`  mode: ${options.mode}`);
  console.log(`  installDir: ${layout.installDir}`);
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
  parseArgs,
  resolveLayout,
  run
};
