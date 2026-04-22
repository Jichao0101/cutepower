# 1 cutepower for Codex

cutepower is a contracts-first governance plugin for the Agent Workflow P1 loop.

If cutepower is not installed yet, tell Codex:

```text
Fetch and follow instructions from .codex/INSTALL.md
```

Important distinction:

- `node scripts/install-plugin.js ...`
  - stages a local plugin copy and writes a marketplace entry so Codex can discover `cutepower` in `/plugins`

After the script finishes, open `/plugins`, search `cutepower`, and choose `Install Plugin`. Re-run the script only when you want to update or replace that staged plugin source.
The install script also merges the cutepower Codex hook entries into the target `~/.codex/` or repo `.codex/` config, instead of changing the development repository's own hook files.
For personal installs, the staged plugin copy now follows the official Codex docs pattern under `~/.codex/plugins/`; repo installs continue to stage under `<repo-root>/plugins/`.

Current repository note:

- the current repository is the development source, not the default runtime install source
- install cutepower into a user or repo plugin directory before treating it as runtime truth
- Do not treat a host knowledge repository as the code root for this project.

Current installed scope:

- P0 runtime assets remain active
- P1 contracts and skills add:
  - `cute-board-run`
  - `cute-functional-review`
  - `cute-incident-investigation`
- static validation uses `scripts/validate-contracts.js`
- runtime gate verification uses `scripts/test-runtime-gates.js`
- Codex lifecycle hook verification uses `scripts/test-codex-hooks.js`
- host runtime injection verification uses `scripts/test-host-runtime.js`
- default-entry takeover verification uses `scripts/test-task-intake.js`
- clean plugin acceptance tests should use an isolated vault

Testing note:

- keep plugin tests pinned to the installed copy or an explicitly generated repo-local install
- do not import external project baselines into plugin truth resolution

After installation, use [README.md](README.md) for the installed plugin overview.
