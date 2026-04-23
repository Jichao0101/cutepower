#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { run: installPlugin } = require('./install-plugin');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runUninstall(args) {
  const command = [
    'stdout_file=$(mktemp)',
    'stderr_file=$(mktemp)',
    `node ${shellQuote(path.join(__dirname, 'uninstall-plugin.js'))} ${args.map(shellQuote).join(' ')} >"$stdout_file" 2>"$stderr_file"`,
    'status=$?',
    'cat "$stdout_file"',
    'cat "$stderr_file" >&2',
    'rm -f "$stdout_file" "$stderr_file"',
    'exit $status',
  ].join('; ');
  const result = spawnSync(
    '/bin/bash',
    ['-lc', command],
    { encoding: 'utf8' }
  );
  assert(result.status === 0, `uninstall command failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function hookCommands(filePath, eventName) {
  const hooks = readJson(filePath).hooks[eventName] || [];
  return hooks.flatMap((entry) => (entry.hooks || []).map((hook) => hook.command));
}

function main() {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cutepower-uninstall-'));
  const fakeHome = path.join(sandboxRoot, 'home');
  const fakeRepoRoot = path.join(sandboxRoot, 'repo');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeRepoRoot, { recursive: true });

  fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
  fs.writeFileSync(
    path.join(fakeHome, '.codex', 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write',
            hooks: [
              {
                type: 'command',
                command: 'echo existing-post-tool-hook',
              },
            ],
          },
        ],
      },
    }, null, 2)}\n`,
    'utf8'
  );

  fs.mkdirSync(path.join(fakeRepoRoot, '.codex'), { recursive: true });
  fs.writeFileSync(
    path.join(fakeRepoRoot, '.codex', 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            matcher: 'legacy',
            hooks: [
              {
                type: 'command',
                command: 'echo legacy-user-hook',
              },
            ],
          },
        ],
      },
    }, null, 2)}\n`,
    'utf8'
  );

  installPlugin(['--mode', 'personal', '--home', fakeHome]);
  installPlugin(['--mode', 'repo', '--target-root', fakeRepoRoot]);

  const personalPluginDir = path.join(fakeHome, '.codex', 'plugins', 'cutepower');
  const personalHooksPath = path.join(fakeHome, '.codex', 'hooks.json');
  const personalMarketplacePath = path.join(fakeHome, '.agents', 'plugins', 'marketplace.json');
  const repoPluginDir = path.join(fakeRepoRoot, 'plugins', 'cutepower');
  const repoHooksPath = path.join(fakeRepoRoot, '.codex', 'hooks.json');
  const repoMarketplacePath = path.join(fakeRepoRoot, '.agents', 'plugins', 'marketplace.json');

  const dryRunSummary = runUninstall(['--mode', 'personal', '--home', fakeHome, '--dry-run']);
  assert(dryRunSummary.dry_run === true, 'dry-run summary should report dry_run=true');
  assert(dryRunSummary.removed.staged_plugin_copy === true, 'dry-run should report staged plugin copy removal');
  assert(dryRunSummary.removed.hook_registrations > 0, 'dry-run should report hook removals');
  assert(fs.existsSync(personalPluginDir), 'dry-run must not delete staged personal plugin copy');
  assert(
    hookCommands(personalHooksPath, 'UserPromptSubmit').some((command) => command.includes('codex-hooks.js')),
    'dry-run must not remove personal cutepower hooks'
  );

  const personalSummary = runUninstall(['--mode', 'personal', '--home', fakeHome]);
  assert(personalSummary.removed.staged_plugin_copy === true, 'personal uninstall should remove staged plugin copy');
  assert(!fs.existsSync(personalPluginDir), 'personal uninstall should remove plugin directory');
  assert(
    !hookCommands(personalHooksPath, 'UserPromptSubmit').some((command) => command.includes('codex-hooks.js')),
    'personal uninstall should remove cutepower UserPromptSubmit hook'
  );
  assert(
    hookCommands(personalHooksPath, 'PostToolUse').includes('echo existing-post-tool-hook'),
    'personal uninstall should preserve unrelated hooks'
  );
  assert(
    !readJson(personalMarketplacePath).plugins.some((plugin) => plugin.name === 'cutepower'),
    'personal uninstall should remove marketplace entry'
  );

  const repoSummary = runUninstall(['--mode', 'repo', '--target-root', fakeRepoRoot]);
  assert(repoSummary.removed.staged_plugin_copy === true, 'repo uninstall should remove staged plugin copy');
  assert(!fs.existsSync(repoPluginDir), 'repo uninstall should remove repo plugin directory');
  assert(
    !hookCommands(repoHooksPath, 'PreToolUse').some((command) => command.includes('codex-hooks.js')),
    'repo uninstall should remove cutepower PreToolUse hook'
  );
  assert(
    hookCommands(repoHooksPath, 'UserPromptSubmit').includes('echo legacy-user-hook'),
    'repo uninstall should preserve unrelated UserPromptSubmit hook'
  );
  assert(
    !readJson(repoMarketplacePath).plugins.some((plugin) => plugin.name === 'cutepower'),
    'repo uninstall should remove repo marketplace entry'
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
