---
name: taskmd-rt
description: Run the Noisy Room task document workflow as a simple Codex/Gemini roundtable. Use when the user invokes `$noisy:taskmd-rt` or asks to alternate `noisy:tmd` work between Codex CLI and Gemini CLI using one `.noisy_room/tasks/*.md` task doc. Supports `-r N` rounds; one round means two delegated CLI turns.
---

# Taskmd Roundtable

## Purpose

Alternate `noisy:tmd` work between Codex CLI and Gemini CLI on one shared task doc.

This skill is procedural. Do not use a helper script. Run the CLI calls directly from Bash.
The current agent is only the orchestrator once a task doc exists. Do not complete a delegated Codex or Gemini turn yourself.

## Inputs

- User prompt: the task instruction to pass through.
- Optional task doc path: an existing `.noisy_room/tasks/*.md`.
- Optional `-r N`: number of rounds. Default: `1`.

One round means two delegated turns after a task doc exists. Two rounds means four delegated turns. Bootstrap does not count.

## Workflow

1. Parse `-r N`. If omitted, use `1`.
2. Resolve the task doc:
   - If the user provides a `.noisy_room/tasks/*.md` path, use it.
   - Otherwise, use the only task doc under `.noisy_room/tasks/`.
   - If no task doc exists, run `noisy:tmd` in the current agent to create or select one. Then continue with all `N` rounds.
3. Resolve the workspace root:
   - Use the project directory that owns the task doc.
   - Keep the task doc path relative to that workspace root.
   - Run every delegated CLI command from that workspace root.
4. Resolve the aggregate log file:
   - Create `.noisy_room/logs/` under the workspace root.
   - Use `.noisy_room/logs/<task-doc-stem>.taskmd-rt.log`.
   - Create this log by default. Do not require a flag.
5. Resolve Gemini include directories:
   - Read the task doc and user prompt for explicit absolute paths outside the workspace root.
   - Include only task-relevant external reference directories, such as a reference repo named in Knowledge.
   - If the path is a file, include its parent directory.
   - Do not include broad directories such as `$HOME`, `/Users/<name>`, or a whole projects parent unless the user explicitly asks.
   - Pass each included directory to Gemini with `--include-directories`.
6. Set total delegated turns to `2 * N`.
7. For each delegated turn:
   - Read the latest `Worklog` metadata from the task doc.
   - Choose the scheduled CLI:
     - For the first delegated turn, choose the opposite CLI from the latest `agent` value:
       - `agent: "codex-cli"` means run Gemini next.
       - `agent: "gemini-cli"` means run Codex next.
     - For later delegated turns, choose the opposite CLI from the CLI attempted in the previous delegated turn, even if that previous turn failed.
   - Note the current latest Worklog entry before calling the CLI.
   - Before the first delegated CLI call, report the aggregate log as a Markdown file link with a readable relative label and an absolute filesystem target.
   - Append a turn header to the aggregate log.
   - Run the chosen CLI with the same task doc path and user prompt. Pipe combined output through `tee -a "$log_file"` so it is visible live and appended to the log.
   - After the CLI exits, verify the task doc has a new latest Worklog entry from that CLI.
   - Append the exit status and verification result to the aggregate log.
   - If the CLI exited nonzero or the Worklog did not advance, report the failed turn with the exit status and verification result, then continue to the next scheduled delegated turn.
8. After all scheduled delegated turns have run, enforce the log line limit.

Do not retry the same CLI just because a failed turn left the task doc's latest Worklog unchanged.
Always re-read the latest Worklog before each turn so verification baselines use the current task doc state.
Do not count the orchestrating agent's own edits as a delegated turn. A delegated turn means a Bash `codex` or `gemini` process ran and appended the Worklog entry.
Do not run delegated CLIs from the skill directory or plugin checkout. Gemini trusts the current working directory, so running from the wrong directory can fail with "Gemini CLI is not running in a trusted directory."
Do not let Gemini discover external reference paths by trial and error. If a task doc names an external reference repo that Gemini may inspect, pass that repo through `--include-directories` before the turn starts.

## Aggregate Log

Each task doc has one default-on aggregate log:

```text
.noisy_room/logs/<task-doc-stem>.taskmd-rt.log
```

Append every roundtable run to that file. Do not create separate per-turn log files.

For each turn, log:

- UTC timestamp.
- Turn number and total delegated turns.
- Chosen CLI.
- Command.
- Combined stdout/stderr.
- Exit status.
- Worklog verification result.

When running a delegated command, preserve the CLI status from the pipeline:

```sh
set -o pipefail
<delegated-command> 2>&1 | tee -a "$log_file"
status=${PIPESTATUS[0]}
```

Limit the aggregate log to 100,000 lines. After a run completes, if the log is larger, keep the newest 100,000 lines and remove older lines. Do not trim during a delegated turn.

## Delegated Prompts

For Codex CLI, run Bash like:

```sh
codex exec --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox -C "$workspace_root" '$noisy:tmd .noisy_room/tasks/<task-doc>.md <user prompt>

Roundtable turn <turn>/<total-turns>.
Append a new Worklog entry before exiting.
In Worklog/Roadmap/Archived metadata, write "agent": "codex-cli".'
```

Run delegated Codex in the Codex CLI equivalent of Gemini YOLO mode: `--dangerously-bypass-approvals-and-sandbox`. Do not let it inherit a read-only sandbox from the caller or user config; a Codex roundtable turn must be able to update the workspace task doc and any task outputs under the workspace root.

For Gemini CLI, run Bash like:

```sh
cd "$workspace_root" && GEMINI_CLI_TRUST_WORKSPACE=true gemini --skip-trust --approval-mode yolo "${gemini_include_args[@]}" --prompt '/noisy:tmd .noisy_room/tasks/<task-doc>.md <user prompt>

Roundtable turn <turn>/<total-turns>.
Append a new Worklog entry before exiting.
In Worklog/Roadmap/Archived metadata, write "agent": "gemini-cli".'
```

If the task doc says `/Users/xsapphire/pj_ml/pj_mgba_mem` is a reference repo and the workspace root is `/Users/xsapphire/pj_ml/pj_mgba_mem_2`, set:

```sh
gemini_include_args=(--include-directories /Users/xsapphire/pj_ml/pj_mgba_mem)
```

This lets Gemini inspect the named reference repo without treating the workspace root or skill directory as wrong.

Assume Bash can call `codex` and `gemini` directly. Do not add environment probing, generated wrapper scripts, or fallback machinery unless the user asks for it.

## Turn Verification

A delegated turn succeeds only when both are true:

- The CLI exits with status `0`.
- The task doc has a new latest Worklog entry from the expected CLI.

A delegated turn fails when either is true:

- The CLI exits nonzero.
- The task doc has no new latest Worklog entry from the expected CLI.

Do not fail a turn only because the CLI transcript contains a recovered error. Gemini may print an edit-tool error before a later success summary. If Gemini exits `0` and the Worklog advanced, treat the turn as successful and continue.

Do not trust success prose by itself. If output says the CLI appended a Worklog entry but the task doc did not advance, treat the turn as failed.

A failed delegated turn is a turn outcome, not a roundtable stop condition. Log it, report it, and continue with the opposite CLI on the next scheduled turn. Do not edit the task doc yourself to compensate for a missing Worklog entry.

## Metadata Rules

Initial roundtable routing depends only on the latest Worklog metadata:

```json
{ "agent": "codex-cli", "trigger": "roadmap" }
```

Do not route from prose, Roadmap metadata, or Archived metadata.
After the first delegated turn in a run, route by alternating from the previously attempted CLI so a failed turn cannot cause the same CLI to be selected again.

Each delegated call must append a new Worklog entry. Editing the previous Worklog or only changing Roadmap is a failed roundtable turn.

## Reporting

Before the first delegated CLI call:

- Report the aggregate log path as a Markdown file link with a readable relative label and an absolute filesystem target:
  `[.noisy_room/logs/<task-doc-stem>.taskmd-rt.log](/abs/workspace/.noisy_room/logs/<task-doc-stem>.taskmd-rt.log)`.
- Do not write the aggregate log link into the task doc.

After all scheduled delegated turns have run:

- Report the task doc path.
- Report the aggregate log path again if useful, using the same Markdown file link format.
- Summarize how many delegated turns were attempted, how many succeeded verification, and how many failed.
- If any turns failed, list each failed turn with CLI, exit status, verification result, and whether later turns still ran.
