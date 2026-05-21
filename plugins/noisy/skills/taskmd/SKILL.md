---
name: taskmd
description: Use one markdown task document under `.noisy_room/tasks/*.md` as durable task state. Use when the user invokes `$noisy:taskmd`, `/noisy:taskmd`, or asks to create, continue, revisit, refine, or track a task doc. Supports `--new`, `--continue`, `--revisit`, and `--revisit-threshold <N>`; also infer actions from natural language such as "create a task doc using 1.md as reference".
---

# Task MD

## Purpose

Use one mandatory-format markdown document as the source of truth for a task's goal, knowledge, progress, worklog, TODOs, and archived history.

Task docs live in:

```text
.noisy_room/tasks/*.md
```

Treat `$noisy:taskmd ...`, `/noisy:taskmd ...`, and `noisy:taskmd ...` as equivalent invocations.

## Dispatch

Parse options and action flags first:

- `--new`: create a task doc from the prompt and any referenced source docs.
- `--continue`: work on an existing task using its task doc as state.
- `--revisit`: refresh an existing task doc without executing task work.
- `--revisit-threshold <N>`: override the default auto-revisit threshold for this invocation. Use a non-negative integer; `0` means always revisit before an inferred continue.

Default auto-revisit threshold: 5 Worklog records after the latest `trigger: "revisit"` Worklog record.

If any unsupported `--flag` is present, report the supported flags and options. If multiple supported action flags remain, ask the user to choose one.

When no flag is present, infer intent:

- Words like `create`, `new`, `start`, or `make a task doc` -> `--new`.
- Words like `continue`, `resume`, `work on`, or `advance the task from its TODO` -> `--continue`.
- Words like `revisit`, `refine`, `refresh`, `review`, or `update the doc` -> `--revisit`.
- No prompt -> default to `--continue`.
- Prompt but unclear intent -> search `.noisy_room/tasks/*.md` for related docs. If none exist, use `--new`; if matches exist, ask whether to create new, continue one, or revisit one.

When no action flag is present and intent resolves to `--continue`, resolve the task doc, count Worklog records after the latest `trigger: "revisit"` record, and compare the count to the threshold. If no revisit record exists, treat the doc as due. If due, run `Action: Revisit / Refine` first, then immediately run `Action: Continue` on the refreshed doc. If not due, run `Action: Continue` directly.

When a prompt references files, such as `use 1.md as reference`, read those files before acting. If a referenced file cannot be found, ask for the correct path.

## Related Skill Use

After resolving the action target, use another available skill only when the current prompt or selected active TODO names it, or when the current action clearly requires a specialized workflow matched by that skill's name/description. `Goal`, `Knowledge`, and `Progress` may inform the decision; treat `Worklog` and `Archived` as historical unless the active TODO refers to them.

Prefer the most specific match. Do not invent skills or load loosely related skills. For `New` and `Revisit`, related skills are consult-only: read relevant guidance for terminology, constraints, expected outputs, or questions, but do not run commands, edit non-task files, dispatch sub-workflows, or execute task work. For `Continue`, use related skills only after selecting the TODO and understanding `Goal`, `Knowledge`, and `Progress`.

## Task Document Contract

Every task doc must use exactly this top-level structure and order. Normalize older or malformed docs before using them as task state.

````markdown
# <Task Title>

## Goal

<Desired outcome, including important non-goals.>

## Knowledge

<Durable facts, assumptions, constraints, decisions, and useful references.>

## Progress

<Current task state: completed work, active work, blockers, and next likely move.>

## Worklog

### <YYYY-MM-DD HH:mm:ss UTC> - <Short summary>

```jsonl
{ "agent_cli": "codex-cli", "session_id": "<session-id>", "worklog_id": "<generated-unique-id>", "trigger": "<todo|revisit>" }
```

<Session delta: actions taken, findings, decisions, files touched, blockers, and follow-up.>

## TODO

### <YYYY-MM-DD HH:mm:ss UTC> - <Short action summary>

```jsonl
{ "agent_cli": "codex-cli", "session_id": "<session-id>" }
```

<Concrete next action and observable completion condition.>

## Archived

### <YYYY-MM-DD HH:mm:ss UTC> - <Short archived summary>

```jsonl
{ "type": "todo|knowledge", "agent_cli": "codex-cli", "session_id": "<session-id>" }
```

<Archived content, why it moved here, and what replaced it if anything.>
````

Rules:

- Do not rename, remove, reorder, or add top-level sections unless the user changes this contract.
- Keep `Knowledge` and `Progress` short and current; move stale meaningful content to `Archived` before replacing it.
- Keep `Worklog` and `Archived` append-only except for malformed metadata or obvious typos.
- Put exactly one single-line fenced `jsonl` metadata object after each dated `###` entry heading within `Worklog`, `TODO`, and `Archived`.
- Set Worklog `trigger` to `"todo"` for task work from an active TODO, and `"revisit"` for doc-only creation, review, or research records.
- When normalizing legacy Worklog metadata without `trigger`, infer it only when the record clearly describes task work or doc-only review; ask before changing unclear historical metadata.
- Generate stable `worklog_id` values for Worklog records. Add `worklog_id` to TODO or Archived metadata only when tied to a specific Worklog record.
- Keep only active actionable items in `TODO`; archive completed, dropped, or superseded items with `type: "todo"`.
- Archive stale knowledge/progress with `type: "knowledge"`.

## Existing Task Doc Baseline

For `Continue` and `Revisit / Refine`, establish this baseline before action-specific work:

1. Inspect the prompt and recent context for an explicit `.noisy_room/tasks/*.md` path, an open/current task doc, a recently mentioned task doc, or another unambiguous candidate.
2. Read any candidate doc and verify it is the target by checking whether `Goal`, `Progress`, active `TODO`, and the user's intent refer to the same task.
3. Search `.noisy_room/tasks/*.md` only when no candidate is available, the candidate does not match, or multiple plausible docs remain. Ask if selection is still unclear.
4. Normalize the doc to the mandatory contract if needed.
5. Build the current-state picture from `Goal`, `Knowledge`, `Progress`, active `TODO`, and relevant `Archived` entries. Use `Archived` to avoid reviving completed, dropped, or superseded work unless current evidence makes it relevant again.

## Existing Task Doc Update Order

When updating an existing task doc after `Continue` or `Revisit / Refine`:

1. Append a `Worklog` record with the correct `trigger`.
2. Append `Archived` entries for meaningful removed, completed, superseded, or stale TODO/knowledge/progress content.
3. Rewrite `Knowledge`, `Progress`, and active `TODO` from the updated situation.

## Action: New

Create a task doc only; do not execute task work.

1. Require enough prompt/source material to name the task and infer a goal. Ask if missing.
2. Read referenced source docs/files from the prompt.
3. Create `.noisy_room/tasks/` if needed.
4. Choose a concise lowercase hyphenated slug and create a new `.md` file without overwriting an existing file.
5. Fill the mandatory contract from the prompt and source docs:
   - `Goal`: summarize the requested outcome.
   - `Knowledge`: capture stable facts, assumptions, constraints, decisions, and references from the prompt/source docs.
   - `Progress`: state that the task doc was created and implementation has not started.
   - `Worklog`: add an initial creation record with `trigger: "revisit"`, mentioning referenced source docs when used.
   - `TODO`: add the first concrete next action.
   - `Archived`: leave empty unless source material explicitly contains stale or superseded content.
6. Report the created task doc path.

## Action: Continue

Work from an existing task doc, then update it.

1. Establish `Existing Task Doc Baseline`.
2. Choose the highest-priority active `TODO` that advances the `Goal` unless the user selected another item. If TODO is empty, infer the next step from the baseline state; ask if no safe next step is clear.
3. Do the task work, using the task doc as the durable state throughout.
4. Apply `Existing Task Doc Update Order` with `trigger: "todo"`. Make `Progress` reflect the work just completed, and make `TODO` reflect the next best step toward the `Goal`.
5. Keep the task doc as the durable state, not a separate checklist.

## Action: Revisit / Refine

Refresh an existing task doc only; do not execute task work.

1. Establish `Existing Task Doc Baseline`.
2. Review Worklog records since the latest `trigger: "revisit"` record, or all Worklog records if none exists. Identify completed work, decisions made, tools used, active uncertainty, prior decisions that should not be accidentally reopened, and loophole patterns: repeated workarounds, shortcuts, scope drift, or revived archived work that bypasses the task's goal or constraints.
3. When web access is available, web search for tools and knowledge that could help the recent work: actively maintained libraries, open-source projects, official docs, GitHub releases/issues, examples, articles, or known techniques. Prefer recently created or updated sources, and judge whether each source should change assumptions, approach, or next TODOs.
4. Treat the baseline state as possibly stale. Compare it with the latest prompt, referenced files, files cited by the doc, minimal repo checks needed to validate specific stale or conflicting claims, useful external research, and any loophole patterns from Worklog/Archived. Avoid repo-wide discovery unless the user asks for it.
5. Apply `Existing Task Doc Update Order` with `trigger: "revisit"` without executing task work. The Worklog must summarize the log range reviewed, research performed, useful sources or rejected leads, and doc-only decisions. Preserve still-valid content; rewrite stale or inaccurate `Knowledge`, `Progress`, and active `TODO`; and add missing current information.
6. If loophole patterns were found, add explicit `Knowledge` guardrails that forbid or prevent the bypass, then align `Progress` and TODO so future work follows the intended path.
7. If external tools or knowledge are useful, update `Knowledge` and `TODO` so future task work can use them.
8. Ask targeted questions only when conflicts cannot be resolved from the prompt, referenced files, repo, or research.
9. Report the task doc path and summarize doc-only changes.
