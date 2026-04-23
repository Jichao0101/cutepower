#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveLayout } = require('./install-plugin');
const { getManifestPath, readInstallManifest } = require('./install-manifest');

const pluginName = 'cutepower';

function usage() {
  process.stdout.write(`Usage:
  node scripts/uninstall-plugin.js --mode personal [--home <dir>] [--dry-run]
  node scripts/uninstall-plugin.js --mode repo --target-root <repo-root> [--dry-run]

Options:
  --mode <personal|repo>   Uninstall from a user home or a repo-local plugin root.
  --home <dir>             Home directory to use for personal uninstall. Defaults to $HOME.
  --target-root <dir>      Repo root to use for repo uninstall.
  --dry-run                Print the uninstall summary without changing files.
\n`);
}

function parseArgs(argv) {
  const options = {
    mode: null,
    home: os.homedir(),
    targetRoot: null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      options.mode = argv[++index] || null;
    } else if (arg === '--home') {
      options.home = argv[++index] || null;
    } else if (arg === '--target-root') {
      options.targetRoot = argv[++index] || null;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.mode || !['personal', 'repo'].includes(options.mode)) {
    throw new Error('Missing or invalid --mode. Use personal or repo.');
  }

  if (options.mode === 'repo' && !options.targetRoot) {
    throw new Error('--target-root is required for repo uninstalls.');
  }

  return options;
}

function removeDir(targetPath, dryRun) {
  if (!dryRun) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value, dryRun) {
  if (dryRun) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isInstalledMarketplaceEntry(plugin, layout) {
  return plugin
    && plugin.name === pluginName
    && plugin.source
    && plugin.source.source === 'local'
    && plugin.source.path === layout.sourcePath;
}

function pruneMarketplaceEntry(layout, dryRun) {
  if (!fs.existsSync(layout.marketplacePath)) {
    return {
      path: layout.marketplacePath,
      file_exists: false,
      changed: false,
      removed_plugin_count: 0,
      preserved_plugin_count: 0,
    };
  }

  const marketplace = readJson(layout.marketplacePath, { plugins: [] });
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const nextPlugins = plugins.filter((plugin) => !isInstalledMarketplaceEntry(plugin, layout));
  const removedPluginCount = plugins.length - nextPlugins.length;
  const changed = removedPluginCount > 0;

  if (changed) {
    writeJson(layout.marketplacePath, {
      ...marketplace,
      plugins: nextPlugins,
    }, dryRun);
  }

  return {
    path: layout.marketplacePath,
    file_exists: true,
    changed,
    removed_plugin_count: removedPluginCount,
    preserved_plugin_count: nextPlugins.length,
  };
}

function removeInstalledCopy(layout, dryRun) {
  const exists = fs.existsSync(layout.installDir);
  if (exists) {
    removeDir(layout.installDir, dryRun);
  }
  return {
    path: layout.installDir,
    existed: exists,
    removed: exists,
  };
}

function buildSummary(options, layout, results) {
  return {
    plugin: pluginName,
    mode: options.mode,
    dry_run: options.dryRun,
    install_root: layout.installRoot,
    install_dir: layout.installDir,
    manifest_path: getManifestPath(layout),
    manifest_found: results.manifestFound,
    removed: {
      staged_plugin_copy: results.installedCopy.removed,
      marketplace_entries: results.marketplace.removed_plugin_count,
    },
    remaining: results.postCheck.remaining,
    warnings: results.postCheck.warnings,
    preserved: {
      marketplace_entries: results.marketplace.preserved_plugin_count,
    },
    marketplace: results.marketplace,
    installed_copy: results.installedCopy,
  };
}

function postCheck(layout) {
  const warnings = [];
  const marketplaceEntries = [];
  const pluginPathExists = fs.existsSync(layout.installDir);

  if (fs.existsSync(layout.marketplacePath)) {
    const marketplace = readJson(layout.marketplacePath, { plugins: [] });
    for (const plugin of Array.isArray(marketplace.plugins) ? marketplace.plugins : []) {
      if (isInstalledMarketplaceEntry(plugin, layout)) {
        marketplaceEntries.push({
          file: layout.marketplacePath,
          name: plugin.name,
          source_path: plugin.source.path,
        });
      }
    }
  }

  if (marketplaceEntries.length > 0) {
    warnings.push(`Residual marketplace entry remains in ${layout.marketplacePath}`);
  }
  if (pluginPathExists) {
    warnings.push(`Installed plugin copy still exists at ${layout.installDir}`);
  }

  return {
    remaining: {
      marketplace_entries: marketplaceEntries,
      plugin_path_exists: pluginPathExists,
    },
    warnings,
  };
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const layout = resolveLayout({
    mode: options.mode,
    home: options.home,
    targetRoot: options.targetRoot,
  });
  const manifest = readInstallManifest(layout);
  const warnings = [];
  if (!manifest) {
    warnings.push(`Legacy install or missing manifest: ${getManifestPath(layout)}`);
  }
  const marketplace = pruneMarketplaceEntry(layout, options.dryRun);
  const installedCopy = removeInstalledCopy(layout, options.dryRun);
  const postCheckResult = postCheck(layout);
  postCheckResult.warnings = warnings.concat(postCheckResult.warnings);
  const summary = buildSummary(options, layout, {
    manifestFound: Boolean(manifest),
    installedCopy,
    marketplace,
    postCheck: postCheckResult,
  });
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildSummary,
  parseArgs,
  pruneMarketplaceEntry,
  removeInstalledCopy,
  run,
};
