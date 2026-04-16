# cutepower

cutepower is a plugin-first, contracts-first governance plugin for the Agent Workflow P0 loop.

This README is the installed-plugin overview.

Installation entry:

- Before installation, use [README.codex.md](README.codex.md) and [.codex/INSTALL.md](.codex/INSTALL.md).
- In the current monorepo development layout, cutepower lives at `plugins/cutepower/`.
- If cutepower is split into its own repository, these documents should move to the repository root unchanged.

P0 scope:

- active runtime assets live in the plugin
- core governance contracts live in `contracts/`
- skills consume contracts instead of copying rule text
- `AGENTS.md` and `agents/*.toml` stay as thin bridge layers
- legacy knowledge docs are not active truth sources

P0 does not include:

- P1/P2 skills
- complex hooks
- runtime enforcement
- automatic remediation

Installed-plugin boundaries:

- `contracts/` is the active governance truth source
- `skills/` consumes contracts instead of duplicating rule text
- `AGENTS.md` is a thin runtime bridge with hard stops
- `agents/*.toml` is a compatibility bridge, not a policy source
- `scripts/validate-contracts.js` provides the P0 validation entry

Validation entry:

```bash
node plugins/cutepower/scripts/validate-contracts.js
```
