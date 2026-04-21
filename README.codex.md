# 1 cutepower for Codex

cutepower is a contracts-first governance plugin for the Agent Workflow P1 loop.

If cutepower is not installed yet, tell Codex:

```text
Fetch and follow instructions from .codex/INSTALL.md
```

Important distinction:

- `node scripts/install-plugin.js ...`
  - installs the local runtime plugin copy and writes the marketplace entry so Codex shows `cutepower` as `installed` in `/plugins`

After the first successful script install, cutepower should remain installed for later sessions. Re-run the script only when you want to update or replace that installed plugin source.

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
- default-entry takeover verification uses `scripts/test-task-intake.js`
- clean plugin acceptance tests should use an isolated vault

Testing note:

- keep plugin tests pinned to the installed copy or an explicitly generated repo-local install
- do not import external project baselines into plugin truth resolution

After installation, use [README.md](README.md) for the installed plugin overview.
