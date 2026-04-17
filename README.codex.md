# 1 cutepower for Codex

cutepower is a contracts-first governance plugin for the Agent Workflow P1 loop.

If cutepower is not installed yet, tell Codex:

```text
Fetch and follow instructions from plugins/cutepower/.codex/INSTALL.md
```

Current repository note:

- In this monorepo development layout, cutepower lives at `plugins/cutepower/`.
- If cutepower is split into its own repository, this file should become the repository-root `README.codex.md`.

Current installed scope:

- P0 runtime assets remain active
- P1 contracts and skills add:
  - `cute-board-run`
  - `cute-functional-review`
  - `cute-incident-investigation`
- static validation uses `scripts/validate-contracts.js`
- runtime gate verification uses `scripts/test-runtime-gates.js`
- clean plugin acceptance tests should use an isolated vault

Testing note:

- keep `plugins/cutepower` as the only active truth source during plugin tests
- do not import external project baselines into plugin truth resolution

After installation, use [README.md](README.md) for the installed plugin overview.
