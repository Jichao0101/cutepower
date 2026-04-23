# cutepower Codex Installation

cutepower has two distinct states:

- development source: the git repository you edit
- staged source: the local plugin copy and marketplace entry that make `cutepower` discoverable in `/plugins`
- installed runtime: the plugin state after you explicitly choose `Install Plugin` in Codex

Do not use the development repository root as the default runtime truth source.

For normal use, staging is a one-time setup per target location. After running the install script, `cutepower` should show as available in `/plugins`. You still need the `/plugins` install step once per Codex runtime, and you do not need to repeat the script for every session unless you are refreshing the staged plugin source after changes.

Current plugin stage:

- installed plugin scope is P1
- P0 skills remain active
- P1 adds board run, functional review, and incident investigation skills
- contracts and validation include runtime gate hardening
- external project docs are not an active plugin truth source during installation or testing

## Preferred mode: personal install

Use this when you want a user-level installed plugin that does not depend on the development path.

From the development repository root:

```bash
node scripts/install-plugin.js --mode personal
```

This bootstraps:

```text
~/.codex/plugins/cutepower/
~/.agents/plugins/marketplace.json
```

The marketplace entry points to `./.codex/plugins/cutepower`, so discovery stays under the user home instead of the development repository path.
After this, open `/plugins`, search `cutepower`, and choose `Install Plugin`.

## Repo-scoped install

Use this when a workspace should carry its own reproducible plugin source.

```bash
node scripts/install-plugin.js --mode repo --target-root <repo-root>
```

This bootstraps:

```text
<repo-root>/.agents/plugins/marketplace.json
<repo-root>/plugins/cutepower/
```

The repo marketplace entry points to `./plugins/cutepower`, so discovery stays relative to the repo root.
After this, open `/plugins` in the repo-scoped Codex session, search `cutepower`, and choose `Install Plugin`.

## Force replace an existing install

Re-run with `--force` when you intentionally want to replace an existing installed copy:

```bash
node scripts/install-plugin.js --mode personal --force
node scripts/install-plugin.js --mode repo --target-root <repo-root> --force
```

## Verify

1. Confirm the runtime source is the installed copy, not the development repository.
2. Confirm the marketplace path is relative to the install root.
3. Open `/plugins`, confirm `cutepower` is discoverable, then choose `Install Plugin`.
4. Run validation from the bootstrapped plugin copy.

Recommended commands:

```bash
node scripts/test-install-plugin.js
node scripts/validate-contracts.js
node scripts/test-runtime-gates.js
node scripts/test-task-profile.js
node scripts/test-task-intake.js
```

For a personal install, verify:

```bash
test -f ~/.codex/plugins/cutepower/.codex-plugin/plugin.json
test -f ~/.agents/plugins/marketplace.json
```

For a repo install, also verify:

```bash
test -f <repo-root>/plugins/cutepower/.codex-plugin/plugin.json
test -f <repo-root>/.agents/plugins/marketplace.json
```

## Updating

Update the development repository first, then refresh the installation copy:

```bash
git pull --ff-only
node scripts/install-plugin.js --mode personal --force
```

Or for repo-scoped installs:

```bash
git pull --ff-only
node scripts/install-plugin.js --mode repo --target-root <repo-root> --force
```

## Uninstalling

Use the uninstall script so the staged copy, marketplace entry, hook registrations, and manifest-tracked config changes are rolled back together:

```bash
node scripts/uninstall-plugin.js --mode personal
node scripts/uninstall-plugin.js --mode repo --target-root <repo-root>
```

Each install writes `.install-manifest.json` next to the staged plugin copy. Uninstall reads that manifest first and falls back to legacy path-based cleanup only when the manifest is missing.

## Migrating from direct-link installs

If you previously linked or cloned cutepower directly into a host workspace and treated that path as runtime truth:

1. Keep that repository only as development source.
2. Reinstall with `node scripts/install-plugin.js --mode personal` or `--mode repo`.
3. Remove stale marketplace entries that still point at the old development path.
4. Restart Codex.
