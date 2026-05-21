---
name: taskmd
description: Use one markdown task document under `.noisy_room/tasks/*.md` as durable task state. Use when the user invokes `$noisy:taskmd`, `/noisy:taskmd`, or asks to create, continue, revisit, refine, or track a task doc. Supports `--new`, `--continue`, `--revisit`, and `--revisit-threshold <N>`; also infer actions from natural language such as "create a task doc using 1.md as reference".
---

# Task MD

## Purpose

Use one mandatory-format markdown document as the source of truth for a task's goal, knowledge, progress, worklog, roadmap, and archived history.

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
- Words like `continue`, `resume`, `work on`, or `advance the task from its Roadmap` -> `--continue`.
- Words like `revisit`, `refine`, `refresh`, `review`, or `update the doc` -> `--revisit`.
- No prompt -> default to `--continue`.
- Prompt but unclear intent -> search `.noisy_room/tasks/*.md` for related docs. If none exist, use `--new`; if matches exist, ask whether to create new, continue one, or revisit one.

When no action flag is present and intent resolves to `--continue`, resolve the task doc, count Worklog records after the latest `trigger: "revisit"` record, and compare the count to the threshold. If no revisit record exists, treat the doc as due. If due, run `Action: Revisit / Refine` first, then immediately run `Action: Continue` on the refreshed doc. If not due, run `Action: Continue` directly.

When a prompt references files, such as `use 1.md as reference`, read those files before acting. If a referenced file cannot be found, ask for the correct path.

## Related Skill Use

After resolving the action target, use another skill only when the prompt, active Roadmap, or action clearly calls for it. `Goal`, `Knowledge`, and `Progress` may inform the decision; treat `Worklog` and `Archived` as history unless the active Roadmap refers to them.

Prefer the most specific match. Do not invent skills or load loose matches. For `New` and `Revisit`, related skills are consult-only: read guidance, but do not run commands, edit non-task files, dispatch sub-workflows, or execute task work. For `Continue`, use related skills only after selecting the Roadmap item to execute and reading `Goal`, `Knowledge`, `Progress`, and the rest of the Roadmap.

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
{ "agent": "codex-cli", "session_id": "<session-id>", "worklog_id": "<generated-unique-id>", "trigger": "<roadmap|revisit>" }
```

<Session delta: actions taken, findings, decisions, files touched, blockers, and follow-up.>

## Archived

### <YYYY-MM-DD HH:mm:ss UTC> - <Short archived summary>

```jsonl
{ "type": "roadmap", "id": "R001", "deps": [], "agent": "codex-cli", "session_id": "<session-id>" }
```

<Archived roadmap content, why it moved here, and what replaced it if anything. For archived knowledge/progress instead, use `type: "knowledge"` and omit roadmap-only `id` and `deps`.>

## Roadmap

### R001 - <Short action summary>

```jsonl
{ "id": "R001", "created_at": "<YYYY-MM-DD HH:mm:ss UTC>", "deps": [], "agent": "codex-cli", "session_id": "<session-id>" }
```

Rationale: <Why this is the right next task now.>

Task: <Concrete next action and observable completion condition.>
````

Rules:

- Do not rename, remove, reorder, or add top-level sections unless the user changes this contract.
- Keep `Knowledge` and `Progress` short and current; move stale meaningful content to `Archived` before replacing it.
- Keep `Worklog` and `Archived` append-only except for malformed metadata or obvious typos.
- Put exactly one single-line fenced `jsonl` metadata object after each entry heading within `Worklog`, `Roadmap`, and `Archived`.
- Set Worklog `trigger` to `"roadmap"` for task work from an active Roadmap item, and `"revisit"` for doc-only creation, review, or research records.
- When normalizing legacy Worklog metadata with `trigger: "todo"`, rewrite it to `trigger: "roadmap"` when the record clearly describes task work from the old TODO section. When `trigger` is missing, infer it only when the record clearly describes task work or doc-only review; ask before changing unclear historical metadata.
- Generate stable `worklog_id` values for Worklog records.
- Keep `Roadmap` for unarchived plan items that still represent relevant future work or ordering context; archive completed, dropped, or superseded items with `type: "roadmap"`.
- Multiple Roadmap items are normal. Preserve every still-relevant item when updating Roadmap, including items not selected for the current `Continue` turn.
- Every active `Roadmap` item heading must use a stable `R###` ID. Preserve IDs when reordering; assign new items the next unused ID across active Roadmap and archived roadmap items.
- Every active `Roadmap` item metadata object must include `id`, `created_at`, and `deps`. `id` must match the heading, `created_at` uses `YYYY-MM-DD HH:mm:ss UTC`, and `deps` is always an array of `R###` IDs.
- `deps` is context for agent judgment, not a strict scheduler. Prefer clearly unblocked Roadmap items when choosing work, and update Roadmap items/deps during `Continue` and `Revisit` as the task state changes.
- Every active `Roadmap` item body must use `Rationale:` followed by `Task:`. Keep both non-empty and concise. Do not put these fields in metadata.
- Archived roadmap items preserve `id` and `deps`; do not preserve active-item `created_at` in Archived metadata.
- Archive stale knowledge/progress with `type: "knowledge"`.

## Existing Task Doc Baseline

For `Continue` and `Revisit / Refine`, establish this baseline before action-specific work:

1. Inspect the prompt and recent context for an explicit `.noisy_room/tasks/*.md` path, an open/current task doc, a recently mentioned task doc, or another unambiguous candidate.
2. Read any candidate doc and verify it is the target by checking whether `Goal`, `Progress`, active `Roadmap`, and the user's intent refer to the same task.
3. Search `.noisy_room/tasks/*.md` only when no candidate is available, the candidate does not match, or multiple plausible docs remain. Ask if selection is still unclear.
4. Normalize the doc to the mandatory contract if needed. Rename legacy `TODO` to `Roadmap`. Convert legacy active TODO entries to Roadmap items with stable `R###` IDs, `created_at`, `deps: []`, and `Rationale:` / `Task:` bodies while preserving meaning. Do not rewrite archived `type: "todo"` bodies unless malformed metadata blocks break parsing.
5. Build the current-state picture from `Goal`, `Knowledge`, `Progress`, active `Roadmap`, and relevant `Archived` entries. Use `Archived` to avoid reviving completed, dropped, or superseded work unless current evidence makes it relevant again.

## Existing Task Doc Update Order

When updating an existing task doc after `Continue` or `Revisit / Refine`:

1. Append a `Worklog` record with the correct `trigger`.
2. Append `Archived` entries for meaningful removed, completed, superseded, or stale Roadmap/knowledge/progress content.
3. Refresh `Knowledge`, `Progress`, and the full Roadmap set from the updated situation. Preserve still-relevant Roadmap items, update changed items in place, archive completed/dropped/superseded items, and add new items when the next useful work has split into multiple tracks.

## Action: New

Create a task doc only; do not execute task work.

1. Require enough prompt/source material to name the task and infer a goal. Ask if missing.
2. Read referenced files as reference-only inputs; do not modify them.
3. Create `.noisy_room/tasks/` if needed.
4. Choose a concise lowercase hyphenated slug and create a new `.md` file without overwriting an existing file.
5. Fill the mandatory contract from the prompt and source docs:
   - `Goal`: summarize the requested outcome.
   - `Knowledge`: capture stable facts, assumptions, constraints, decisions, and references. List any source files, and note they are reference-only and must not be modified unless the user expands scope.
   - `Progress`: state that the task doc was created and implementation has not started.
   - `Worklog`: add an initial creation record with `trigger: "revisit"`, mentioning referenced source docs when used.
   - `Roadmap`: add at least the first concrete next action as `R001` with `created_at`, `deps: []`, `Rationale:`, and `Task:`. Add additional Roadmap items only when the prompt or source docs already make distinct future tracks clear. Do not include editing source files unless explicitly requested.
   - `Archived`: leave empty unless source material explicitly contains stale or superseded content.
6. Report the created task doc path.

## Action: Continue

Work from an existing task doc, then update it.

1. Establish `Existing Task Doc Baseline`.
2. Choose one Roadmap item to execute: the highest-priority item that advances the `Goal` unless the user selected another item. Consider `deps` when useful, but do not treat it as a strict scheduler. Treat unchosen Roadmap items as plan context to preserve or update, not as stale content. If Roadmap is empty, infer the next step from the baseline state; ask if no safe next step is clear.
3. Do the task work, using the task doc as the durable state throughout.
4. Apply `Existing Task Doc Update Order` with `trigger: "roadmap"`. Make `Progress` reflect the work just completed. Update the full Roadmap set so it keeps every still-relevant item, archives the selected item when completed, revises changed items, and adds multiple next items when the task now has multiple useful tracks.
5. Keep the task doc as the durable state, not a separate checklist.

## Action: Revisit / Refine

Refresh an existing task doc only; do not execute task work.

1. Establish `Existing Task Doc Baseline`.
2. Review Worklog records since the latest `trigger: "revisit"` record, or all records if none exists.
   - Identify completed work, decisions, tools used, uncertainty, and decisions that should not be reopened.
   - Audit Worklog history and active Roadmap items for Goal Drift.
   - Goal Drift means work that no longer advances the `Goal`, widens scope without a user decision, or keeps following side paths.
   - Also look for loopholes: repeated workarounds, shortcuts, scope drift, or revived archived work that bypasses the task's goal or constraints.
3. Decide whether external research is useful before searching. Search only when the task has time-sensitive dependencies, recent Worklog/Roadmap entries mention things that may have changed, or the user asks for research. If research is unnecessary, record that decision in the Worklog and continue locally.
   - When research runs, anchor searches to the session date; if unavailable, get the current date first.
   - Use last revisit/worklog dates in queries, e.g. `as of <current-date>`, `updated since <last-revisit-date>`, `released <year>`, or `latest <tool/topic>`.
   - Prefer sources with explicit created, updated, release, or issue dates: official docs, active GitHub repositories, releases, changelogs, issues, examples, and substantive articles.
   - Do not accept recency by title alone; check source dates and decide whether the source changes assumptions, approach, or next Roadmap items.
4. Treat the baseline as possibly stale. Compare it with the latest prompt, referenced files, cited files, targeted repo checks, useful research, and loophole patterns from Worklog/Archived. Avoid repo-wide discovery unless asked.
5. Apply `Existing Task Doc Update Order` with `trigger: "revisit"` without executing task work.
   - The Worklog must summarize the log range reviewed, whether external research was needed, and doc-only decisions.
   - If research ran, include the date used plus useful sources or rejected leads with dates when available.
   - If Goal Drift or loopholes were found, summarize them explicitly.
   - Preserve valid content; refresh stale or inaccurate `Knowledge`, `Progress`, and the full Roadmap set; add missing current information. Active Roadmap items must use stable `R###` IDs, required metadata, `Rationale:`, and `Task:`.
6. If Goal Drift or loophole patterns were found, correct them narrowly.
   - Add `Knowledge` guardrails that name the pattern and forbid repeating it.
   - Archive drifted, bypassing, completed, dropped, or superseded Roadmap items.
   - Refresh active Roadmap to the smallest useful set of next actions back toward the `Goal`; keep multiple items when they represent distinct still-relevant tracks.
7. If external tools or knowledge are useful, update `Knowledge` and `Roadmap` so future task work can use them.
8. Ask targeted questions only when conflicts cannot be resolved from the prompt, referenced files, repo, or research.
9. Report the task doc path and summarize doc-only changes.
