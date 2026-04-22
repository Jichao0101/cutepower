# Global Hook Light Entry

## Problem diagnosis

- Global hooks are expected to stay installed so `cutepower` can see task entry across repos.
- The failure came from treating `UserPromptSubmit` as a heavy governance gate instead of a light router.
- When a non-governance repo or normal prompt hit that path, the hook could become the failure source instead of passing through.

## Design adjustment

- `UserPromptSubmit` now acts as a light entry classifier.
- Normal greetings, repo explanations, and ordinary non-governance prompts default to legal pass-through.
- Explicit `cutepower` requests still trigger intake and runtime gate evaluation.
- Repo-local governance tasks are only taken over when the current repo looks `cutepower`-active and the prompt matches governance intent.
- `PreToolUse` and `Stop` only enforce hard gates after a session is clearly managed by `cutepower`.

## Fail-safe rules

- `UserPromptSubmit` exceptions degrade to a single legal pass-through JSON object.
- `PreToolUse` and `Stop` exceptions degrade to a single legal block JSON object.
- No hook path is allowed to emit mixed human text and JSON.
