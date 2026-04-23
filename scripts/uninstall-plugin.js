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

function matchesCutepowerHookCommand(command, matchers) {
  if (typeof command !== 'string') {
    return false;
  }
  if (matchers.commands.has(command)) {
    return true;
  }
  return Array.from(matchers.runnerPaths).some((runnerPath) => command.includes(runnerPath));
}

function buildHookMatchers(layout, manifest) {
  const commands = new Set();
  const runnerPaths = new Set([path.join(layout.installDir, 'scripts', 'codex-hooks.js')]);

  for (const registration of manifest?.hook_registrations || []) {
    if (registration.command) {
      commands.add(registration.command);
    }
    if (registration.command && registration.command.includes('codex-hooks.js')) {
      const match = registration.command.match(/"([^"]*codex-hooks\.js)"|([^ ]*codex-hooks\.js)/);
      const runnerPath = match ? (match[1] || match[2]) : null;
      if (runnerPath) {
        runnerPaths.add(runnerPath);
      }
    }
  }

  return { commands, runnerPaths };
}

function pruneHookRegistrations(layout, manifest, dryRun) {
  if (!fs.existsSync(layout.codexHooksPath)) {
    return {
      path: layout.codexHooksPath,
      file_exists: false,
      changed: false,
      removed_hook_count: 0,
      removed_entry_count: 0,
      preserved_hook_count: 0,
      affected_events: [],
    };
  }

  const current = readJson(layout.codexHooksPath, { hooks: {} });
  const next = {
    ...current,
    hooks: {},
  };
  let removedHookCount = 0;
  let removedEntryCount = 0;
  let preservedHookCount = 0;
  const affectedEvents = [];
  const matchers = buildHookMatchers(layout, manifest);

  for (const [eventName, entries] of Object.entries(current.hooks || {})) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const nextEntries = [];

    for (const entry of normalizedEntries) {
      const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
      const retainedHooks = hooks.filter((hook) => !matchesCutepowerHookCommand(hook.command, matchers));

      if (retainedHooks.length !== hooks.length && !affectedEvents.includes(eventName)) {
        affectedEvents.push(eventName);
      }

      removedHookCount += hooks.length - retainedHooks.length;
      preservedHookCount += retainedHooks.length;

      if (hooks.length > 0 && retainedHooks.length === 0) {
        removedEntryCount += 1;
        continue;
      }

      if (retainedHooks.length !== hooks.length) {
        nextEntries.push({
          ...entry,
          hooks: retainedHooks,
        });
        continue;
      }

      nextEntries.push(entry);
    }

    if (nextEntries.length > 0) {
      next.hooks[eventName] = nextEntries;
    }
  }

  const changed = removedHookCount > 0;
  if (changed) {
    writeJson(layout.codexHooksPath, next, dryRun);
  }

  return {
    path: layout.codexHooksPath,
    file_exists: true,
    changed,
    removed_hook_count: removedHookCount,
    removed_entry_count: removedEntryCount,
    preserved_hook_count: preservedHookCount,
    affected_events: affectedEvents,
  };
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

function revertConfigChanges(manifest, dryRun) {
  const changes = Array.isArray(manifest?.config_changes) ? manifest.config_changes : [];
  let removedConfigChanges = 0;
  const touchedFiles = [];

  for (const change of changes) {
    if (!change || !change.file || !fs.existsSync(change.file)) {
      continue;
    }

    let current = fs.readFileSync(change.file, 'utf8');
    const original = current;
    if (change.change_type === 'create_file_with_feature') {
      if (current.trim() === '[features]\ncodex_hooks = true') {
        if (!dryRun) {
          fs.rmSync(change.file, { force: true });
        }
        removedConfigChanges += 1;
        touchedFiles.push(change.file);
      }
      continue;
    }

    if (change.change_type === 'replace_false_with_true') {
      if (/\bcodex_hooks\s*=\s*true\b/.test(current)) {
        current = current.replace(/\bcodex_hooks\s*=\s*true\b/, 'codex_hooks = false');
      }
    } else if (change.change_type === 'insert_under_existing_features') {
      current = current.replace(/\[features\]\ncodex_hooks = true\n/, '[features]\n');
    } else if (change.change_type === 'append_features_section') {
      current = current.replace(/\n?\[features\]\ncodex_hooks = true\n?$/, '\n');
      if (current === '\n') {
        current = '';
      }
    }

    if (current !== original) {
      if (!dryRun) {
        fs.writeFileSync(change.file, current, 'utf8');
      }
      removedConfigChanges += 1;
      touchedFiles.push(change.file);
    }
  }

  return {
    removed_config_changes: removedConfigChanges,
    touched_files: touchedFiles,
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
      hook_registrations: results.hooks.removed_hook_count,
      hook_entries: results.hooks.removed_entry_count,
      config_changes: results.config.removed_config_changes,
    },
    remaining: results.postCheck.remaining,
    warnings: results.postCheck.warnings,
    preserved: {
      marketplace_entries: results.marketplace.preserved_plugin_count,
      hook_registrations: results.hooks.preserved_hook_count,
    },
    hooks: results.hooks,
    marketplace: results.marketplace,
    installed_copy: results.installedCopy,
    config: results.config,
  };
}

function postCheck(layout, manifest) {
  const warnings = [];
  const hookMatchers = buildHookMatchers(layout, manifest);
  const hookCommandsPointingToCutepower = [];
  const marketplaceEntries = [];
  const pluginPathExists = fs.existsSync(layout.installDir);

  if (fs.existsSync(layout.codexHooksPath)) {
    const hooksJson = readJson(layout.codexHooksPath, { hooks: {} });
    for (const [eventName, entries] of Object.entries(hooksJson.hooks || {})) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        for (const hook of Array.isArray(entry.hooks) ? entry.hooks : []) {
          if (matchesCutepowerHookCommand(hook.command, hookMatchers)) {
            hookCommandsPointingToCutepower.push({
              file: layout.codexHooksPath,
              event: eventName,
              matcher: entry.matcher || null,
              command: hook.command,
            });
          }
        }
      }
    }
  }

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

  if (hookCommandsPointingToCutepower.length > 0) {
    warnings.push(`Residual hook commands remain in ${layout.codexHooksPath}`);
  }
  if (marketplaceEntries.length > 0) {
    warnings.push(`Residual marketplace entry remains in ${layout.marketplacePath}`);
  }
  if (pluginPathExists) {
    warnings.push(`Installed plugin copy still exists at ${layout.installDir}`);
  }

  return {
    remaining: {
      hook_commands_pointing_to_cutepower: hookCommandsPointingToCutepower,
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
  const hooks = pruneHookRegistrations(layout, manifest, options.dryRun);
  const config = revertConfigChanges(manifest, options.dryRun);
  const installedCopy = removeInstalledCopy(layout, options.dryRun);
  const postCheckResult = postCheck(layout, manifest);
  postCheckResult.warnings = warnings.concat(postCheckResult.warnings);
  const summary = buildSummary(options, layout, {
    manifestFound: Boolean(manifest),
    installedCopy,
    marketplace,
    hooks,
    config,
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
  matchesCutepowerHookCommand,
  parseArgs,
  pruneHookRegistrations,
  pruneMarketplaceEntry,
  removeInstalledCopy,
  run,
};
