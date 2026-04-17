# 1 cutepower for Codex

cutepower is a contracts-first governance plugin for the Agent Workflow P1 loop.

If cutepower is not installed yet, tell Codex:

```text
Fetch and follow instructions from .codex/INSTALL.md
```

Current repository note:

- cutepower should be used as an independent repository rooted at the current directory.
- Do not treat a host knowledge repository as the code root for this project.

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

- keep the cutepower repository root as the only active truth source during plugin tests
- do not import external project baselines into plugin truth resolution

After installation, use [README.md](README.md) for the installed plugin overview.
