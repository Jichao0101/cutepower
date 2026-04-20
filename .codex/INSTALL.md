# cutepower Codex Installation

cutepower is expected to live at the root of its own repository.

Current plugin stage:

- installed plugin scope is P1
- P0 skills remain active
- P1 adds board run, functional review, and incident investigation skills
- contracts and validation now include minimal runtime gate hardening
- external project docs are not an active plugin truth source during installation or testing

## Prerequisites

- Git is installed.
- You know where your Codex plugin directory lives.
- On Windows, you can create a junction. On Unix-like systems, you can create a symlink.
- You have chosen an explicit source directory for the `cutepower` repository.

## Installation

Do not clone `cutepower` into the current working directory by default.

Choose an explicit source directory first:

- If you are working inside a knowledge repository or workspace, use `./plugins/cutepower`.
- If you manage plugin source code separately, use an independent directory such as `~/src/cutepower`.

Installation and update should follow the same rule:

- If the target directory does not exist, `git clone` into that directory.
- If the target directory already contains the `cutepower` git repository, run `git pull --ff-only` there.
- If the target directory exists but is not the `cutepower` git repository, stop and choose another directory or clean up the conflict.

1. Choose the target source directory.
2. Clone or update `cutepower` in that directory.
3. Link that directory into your Codex plugin directory.
4. Restart Codex so the plugin can be discovered.

Example shape:

```text
TARGET=<plugin-source-dir>
REPO_URL=<cutepower-repo-url>

if [ -d "$TARGET/.git" ]; then
  git -C "$TARGET" pull --ff-only
elif [ -e "$TARGET" ]; then
  echo "Target exists but is not a git repository: $TARGET"
  exit 1
else
  git clone "$REPO_URL" "$TARGET"
fi

ln -s "$TARGET" <codex-plugins-dir>/cutepower
```

## Windows

Use a junction instead of a symlink when needed.

Example shape:

```text
set TARGET=<plugin-source-dir>
set REPO_URL=<cutepower-repo-url>

if exist %TARGET%\.git (
  git -C %TARGET% pull --ff-only
) else (
  if exist %TARGET% (
    echo Target exists but is not a git repository: %TARGET%
  ) else (
    git clone %REPO_URL% %TARGET%
  )
)

mklink /J <codex-plugins-dir>\cutepower %TARGET%
```

## Restart

Fully restart Codex after linking the plugin so skill discovery reloads the plugin tree.

## Isolated Test Vault

For clean plugin acceptance tests, prefer an isolated vault instead of the monorepo workspace.

Minimal shape:

```text
<isolated-vault>/
├── .agents/plugins/marketplace.json
└── plugins/
    └── cutepower -> <cutepower-repo>
```

Use this when you want to avoid monorepo-only artifacts influencing retrieval or perceived truth source priority.
The isolated vault should link to this repository root, not to a nested plugin directory inside another workspace.
If you are starting from inside a knowledge repository, prefer cloning this repository into `./plugins/cutepower` and linking from there instead of cloning into the knowledge root.

## Verify

Start a new Codex session and ask for a task that should use cutepower.

Expected result:

- Codex can discover the plugin.
- Codex can read `contracts/`, `skills/`, and the bridge files.
- Both static contract validation and runtime gate tests can run locally.
- external project documentation is not required for plugin self-validation.

Recommended verification commands:

```text
node scripts/validate-contracts.js
node scripts/test-runtime-gates.js
```

## Updating

1. Go to the existing `cutepower` source directory.
2. Pull the latest changes with `git pull --ff-only`.
3. Restart Codex.
4. Re-run the validation command if needed:

```text
git -C <plugin-source-dir> pull --ff-only
node scripts/validate-contracts.js
node scripts/test-runtime-gates.js
```

## Uninstalling

1. Remove the link or junction from the Codex plugin directory.
2. Optionally delete the cloned cutepower repository.
3. Restart Codex.

## Migrating from chaospower

- Replace any old `chaospower` plugin link or junction with `cutepower`.
- Restart Codex after the rename.
- Treat `cutepower` as the active plugin name for discovery and future updates.
