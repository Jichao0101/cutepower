#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { run: installPlugin } = require('./install-plugin');
const { MANIFEST_FILE } = require('./install-manifest');
const { run: uninstallPlugin } = require('./uninstall-plugin');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-uninstall-'));
  const fakeHome = path.join(sandboxRoot, 'home');
  const fakeRepoRoot = path.join(sandboxRoot, 'repo');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeRepoRoot, { recursive: true });

  installPlugin(['--mode', 'personal', '--home', fakeHome]);
  installPlugin(['--mode', 'repo', '--target-root', fakeRepoRoot]);

  const personalPluginDir = path.join(fakeHome, '.codex', 'plugins', 'cutepower');
  const personalMarketplacePath = path.join(fakeHome, '.agents', 'plugins', 'marketplace.json');
  const personalManifestPath = path.join(personalPluginDir, MANIFEST_FILE);
  const repoPluginDir = path.join(fakeRepoRoot, 'plugins', 'cutepower');
  const repoMarketplacePath = path.join(fakeRepoRoot, '.agents', 'plugins', 'marketplace.json');
  const repoManifestPath = path.join(repoPluginDir, MANIFEST_FILE);

  const dryRunSummary = uninstallPlugin(['--mode', 'personal', '--home', fakeHome, '--dry-run']);
  assert(dryRunSummary.dry_run === true, 'dry-run summary should report dry_run=true');
  assert(dryRunSummary.manifest_found === true, 'dry-run should report manifest_found=true');
  assert(dryRunSummary.removed.staged_plugin_copy === true, 'dry-run should report staged plugin copy removal');
  assert(fs.existsSync(personalPluginDir), 'dry-run must not delete staged personal plugin copy');
  assert(fs.existsSync(personalManifestPath), 'dry-run must not delete install manifest');

  const personalSummary = uninstallPlugin(['--mode', 'personal', '--home', fakeHome]);
  assert(personalSummary.removed.staged_plugin_copy === true, 'personal uninstall should remove staged plugin copy');
  assert(!fs.existsSync(personalPluginDir), 'personal uninstall should remove plugin directory');
  assert(
    !readJson(personalMarketplacePath).plugins.some((plugin) => plugin.name === 'cutepower'),
    'personal uninstall should remove marketplace entry'
  );
  assert(
    personalSummary.remaining.plugin_path_exists === false,
    'personal uninstall post-check should report plugin path removed'
  );
  assert(
    personalSummary.warnings.length === 0,
    'personal uninstall should not warn when manifest-guided cleanup succeeds'
  );

  fs.rmSync(repoManifestPath, { force: true });

  const repoSummary = uninstallPlugin(['--mode', 'repo', '--target-root', fakeRepoRoot]);
  assert(repoSummary.manifest_found === false, 'repo uninstall should report manifest missing fallback');
  assert(repoSummary.removed.staged_plugin_copy === true, 'repo uninstall should remove staged plugin copy');
  assert(!fs.existsSync(repoPluginDir), 'repo uninstall should remove repo plugin directory');
  assert(
    !readJson(repoMarketplacePath).plugins.some((plugin) => plugin.name === 'cutepower'),
    'repo uninstall should remove repo marketplace entry'
  );
  assert(
    repoSummary.warnings.some((warning) => warning.includes('Legacy install or missing manifest')),
    'repo uninstall fallback should warn about missing manifest'
  );

  process.stdout.write('test-uninstall-plugin: ok\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
