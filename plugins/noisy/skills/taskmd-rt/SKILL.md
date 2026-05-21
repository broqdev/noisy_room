---
name: taskmd_rt
description: Run the Noisy Room task document workflow as a Codex/Gemini roundtable. Use when the user invokes `$noisy:taskmd_rt` or asks to alternate `noisy:taskmd` work between Codex CLI and Gemini CLI using an existing or newly created `.noisy_room/tasks/*.md` task doc. Supports `--r N` rounds; one round means two interleaved CLI calls.
---

# Taskmd Roundtable

## Purpose

Proxy `noisy:taskmd` through alternating CLI agents so a task doc moves between Codex and Gemini.

## Required Inputs

- User prompt: the task instruction to pass through.
- Optional task doc path: an existing `.noisy_room/tasks/*.md`.
- Optional `--r <N>`: number of interleave rounds. Default: `1`.

One interleave round means two CLI+skill calls after a task doc exists.

## Workflow

1. Resolve the target workspace and any explicit task doc path.
2. If no task doc exists, delegate directly to `noisy:taskmd` first. Treat this as bootstrap; it does not consume `--r`.
3. After bootstrap, continue only if one task doc exists or a task doc path is explicit.
4. Read the latest `Worklog` metadata from the task doc.
5. Choose the next CLI from the latest `agent` value:
   - `agent: "codex-cli"` -> run Gemini CLI next.
   - `agent: "gemini-cli"` -> run Codex CLI next.
6. Run `2 * rounds` calls. After each CLI call, verify the task doc has one more Worklog metadata record and the latest Worklog belongs to the CLI that just ran. Re-read the task doc before choosing the next CLI.

Use the bundled script for the mechanical work:

```sh
bash plugins/noisy/skills/taskmd-rt/scripts/run_roundtable.sh \
  --r 1 \
  --task-doc .noisy_room/tasks/<task-doc>.md \
  -- <user prompt>
```

If the skill is symlinked into another workspace, use the script path from this skill directory and pass `--workspace <target-workspace>`.

## Metadata Rules

Roundtable routing depends on Worklog metadata:

```json
{ "agent": "codex-cli", "trigger": "todo" }
```

Do not route from prose. Do not use legacy `agent_cli` unless the script reports it is reading a legacy task doc.

Each delegated `noisy:taskmd` call must tell the downstream CLI to write its own agent id:

- Codex CLI writes `agent: "codex-cli"`.
- Gemini CLI writes `agent: "gemini-cli"`.

Each delegated call must append a new Worklog entry. Editing the previous Worklog or only changing TODO is a failed roundtable turn.

## Reporting

After the script exits:

- Report the task doc path.
- Summarize which CLIs ran and how many calls completed.
- If a command fails, report the failing CLI, exit code, and useful output.
