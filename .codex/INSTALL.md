# cutepower Codex Installation

In this monorepo development layout, cutepower currently lives at `plugins/cutepower/`.

Installation steps below are written from the perspective that cutepower is an independent repository/plugin. When cutepower is split out, this file should live at the repository-root `.codex/INSTALL.md`.

## Prerequisites

- Git is installed.
- You know where your Codex plugin directory lives.
- On Windows, you can create a junction. On Unix-like systems, you can create a symlink.

## Installation

1. Clone the cutepower repository.
2. Link the cloned repository into your Codex plugin directory.
3. Restart Codex so the plugin can be discovered.

Example shape:

```text
git clone <cutepower-repo-url>
ln -s <cutepower-repo> <codex-plugins-dir>/cutepower
```

## Windows

Use a junction instead of a symlink when needed.

Example shape:

```text
git clone <cutepower-repo-url>
mklink /J <codex-plugins-dir>\cutepower <cutepower-repo>
```

## Restart

Fully restart Codex after linking the plugin so skill discovery reloads the plugin tree.

## Verify

Start a new Codex session and ask for a task that should use cutepower.

Expected result:

- Codex can discover the plugin.
- Codex can read `contracts/`, `skills/`, and the bridge files.

## Updating

1. Pull the latest changes in the cutepower repository.
2. Restart Codex.
3. Re-run the validation command if needed:

```text
node scripts/validate-contracts.js
```

## Uninstalling

1. Remove the link or junction from the Codex plugin directory.
2. Optionally delete the cloned cutepower repository.
3. Restart Codex.

## Migrating from chaospower

- Replace any old `chaospower` plugin link or junction with `cutepower`.
- Restart Codex after the rename.
- Treat `cutepower` as the active plugin name for discovery and future updates.
