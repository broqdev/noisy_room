---
name: task-md
description: Use a single markdown task document to track a task's goal, decisions, and progress under `.noisy_room/tasks/*.markdown`. Use when the user invokes `$task-md`, asks to start, continue, revisit, refine, or track work in a task markdown doc, or wants task state captured in one durable markdown file. Supports `--new`, `--continue`, and `--revisit`; without an explicit argument, infer the action from the prompt and existing task docs.
---

# Task MD

## Purpose

Use one markdown document as the source of truth for a task's goal, current understanding, decisions, progress, and next actions.

Task documents live in:

```text
.noisy_room/tasks/*.markdown
```

## Argument Dispatch

Parse supported arguments before doing any work:

- `--new`: create a new task markdown document from the user's prompt.
- `--continue`: continue working according to an existing task markdown document.
- `--revisit`: revisit/refine an existing task markdown document without executing task work.

If multiple supported arguments are present, stop and ask the user to choose exactly one.

If an unsupported argument is present, stop and report the supported arguments.

## No-Argument Heuristic

When no supported argument is given:

1. If the user gave no task prompt, default to `--continue`.
2. If the user gave a task prompt, search `.noisy_room/tasks/*.markdown` for existing docs related to the prompt.
3. If no related doc exists, proceed as `--new`.
4. If one or more related docs exist, ask the user which action to take and wait for their reply:

```text
I found related task docs:
1. <path> - <short reason>
2. <path> - <short reason>

Choose:
1. Create a new task markdown doc
2. Reuse one and continue
3. Reuse one and revisit/refine the doc
```

Delegate the user's choice to the corresponding action:

- Choice 1 -> `--new`
- Choice 2 -> `--continue`
- Choice 3 -> `--revisit`

If multiple related docs exist and the chosen action reuses a doc, ask the user which doc to use unless one match is clearly dominant.

## Task Document Contract

Every task document must use this contract. Keep each task in exactly one markdown document under `.noisy_room/tasks/`, and make the document conform before using it as task state.

Required top-level structure:

````markdown
# <Task Title>

## Goal

<The desired outcome. Include important non-goals when they prevent drift.>

## Knowledge

<Stable facts, assumptions, constraints, and decisions that should guide future work.>

## Progress

<Where the task stands now: completed work, active work, blockers, and the next likely move.>

## Worklog

### <YYYY-MM-DD HH:mm:ss UTC> - <Short summary>

```jsonl
{ "agent_cli": "codex-cli", "session_id": "<session-id>", "worklog_id": "<generated-unique-id>" }
```

<Concise record of the session delta: actions taken, findings, decisions, files touched, blockers, and follow-up.>

## TODO

### <YYYY-MM-DD HH:mm:ss UTC> - <Short action summary>

```jsonl
{ "agent_cli": "codex-cli", "session_id": "<session-id>" }
```

<Concrete next action and its observable completion condition.>

## Archived

### <YYYY-MM-DD HH:mm:ss UTC> - <Short archived summary>

```jsonl
{ "type": "todo|knowledge", "agent_cli": "codex-cli", "session_id": "<session-id>" }
```

<Archived content, why it moved here, and what replaced it if anything.>

````

Format requirements:

- Use the required top-level sections exactly as shown, in this order: `Goal`, `Knowledge`, `Progress`, `Worklog`, `TODO`, `Archived`.
- Do not rename, remove, or reorder required top-level sections.
- Do not add extra top-level sections unless the user explicitly changes this contract. Put supporting detail under the nearest required section.
- Keep exactly one `# <Task Title>` heading.
- Keep the document useful and current. Update it as work happens instead of batching all edits at the end.
- When continuing an older or malformed task doc, normalize it to this contract first while preserving all meaningful content. Move content that no longer belongs in current sections to `## Archived`.

Current-state rules:

- Keep `## Knowledge` for durable understanding: facts, assumptions, constraints, decisions, and terms that future sessions should trust.
- Keep `## Progress` for present-tense task state: what is done, what is active, what is blocked, and what should likely happen next.
- When knowledge or progress becomes stale, move the outdated content to `## Archived` with `type: "knowledge"` before replacing it.
- Keep both current sections short enough to scan. Prefer links or file paths over pasted detail when the detail already lives elsewhere.

Worklog rules:

- Treat `## Worklog` as an append-only sequence of records.
- Give each record a level-three heading in 24-hour UTC format: `YYYY-MM-DD HH:mm:ss UTC - <short summary>`.
- Keep the short summary brief enough to scan, usually 3-8 words.
- Put exactly one JSONL metadata line immediately after the record heading. Use a fenced `jsonl` block and keep the JSON object on one line.
- Include `agent_cli`, `session_id`, and `worklog_id` when known. Generate a unique `worklog_id` for new records and keep it stable.
- Add other stable metadata only when it helps future continuation, such as `model`, `branch`, or `task_doc`.
- Write the body of the record after the metadata line. Capture the useful delta: actions taken, findings, decisions, files touched, blockers, and next handoff notes.
- Do not rewrite old worklog records except to fix malformed metadata or obvious typos. Put later corrections in a new record.

TODO rules:

- Treat `## TODO` as the current actionable queue, not a history log.
- Give each TODO item a level-three heading in 24-hour UTC format: `YYYY-MM-DD HH:mm:ss UTC - <short action summary>`.
- Put exactly one JSONL metadata line immediately after the TODO heading. Use a fenced `jsonl` block and keep the JSON object on one line.
- Include `agent_cli` and `session_id` when known. Add `worklog_id` when the TODO came from a worklog record.
- Keep the TODO body concrete and action-oriented. Include the observable completion condition in the same entry.
- Keep only active, relevant items in `## TODO`. Move completed, dropped, or superseded items to `## Archived` with `type: "todo"`.
- If a TODO becomes blocked, keep it in `## TODO` and add the blocker in the body instead of archiving it.

Archived rules:

- Treat `## Archived` as an append-only sequence of resolved TODO items and stale knowledge/progress.
- Give each archived record a level-three heading in 24-hour UTC format: `YYYY-MM-DD HH:mm:ss UTC - <short archived summary>`.
- Put exactly one JSONL metadata line immediately after the archived heading. Use a fenced `jsonl` block and keep the JSON object on one line.
- Use `type: "todo"` for archived TODO entries and `type: "knowledge"` for outdated knowledge, assumptions, decisions, or progress summaries.
- Include `agent_cli` and `session_id` when known. Add `worklog_id` only when the archived record is tied to a specific worklog record.
- Capture what was archived, why it was archived, the final outcome or replacement, and any related worklog heading or file reference needed for future continuation.
- Do not rewrite old archived records except to fix malformed metadata or obvious typos. Put later corrections in a new archived record.

## Action: New

Use `--new` only to create a task markdown document from the user's prompt. Do not start implementing the task unless the user separately asks for execution.

Workflow:

1. Require a task prompt. If the prompt is missing or too vague to name the task, ask the user for the task goal.
2. Create `.noisy_room/tasks/` if needed.
3. Choose a concise lowercase slug from the prompt using hyphen-separated words.
4. Create one new `.markdown` file under `.noisy_room/tasks/`. Use the slug in the filename and avoid overwriting an existing file.
5. Fill the document using the mandatory task document contract:
   - `Goal`: summarize the requested outcome from the prompt.
   - `Knowledge`: capture only facts, assumptions, constraints, and decisions already present in the prompt.
   - `Progress`: state that the task document has been created and implementation has not started.
   - `Worklog`: add the initial creation record.
   - `TODO`: add the first concrete next action implied by the prompt.
   - `Archived`: leave empty unless the prompt explicitly contains stale or superseded information.
6. Report the created task doc path.

## Action: Continue

Use `--continue` to keep working on an existing task with its task document as the source of truth.

Workflow:

1. Select the relevant existing task doc. If no doc is clearly selected, search `.noisy_room/tasks/*.markdown` and ask the user to choose when needed.
2. Read the entire task doc before acting.
3. Normalize it to the mandatory task document contract if needed.
4. Follow `## TODO` and work on the highest-priority actionable item unless the user prompt explicitly selects a different item.
5. If `## TODO` is empty or no item is actionable, infer the next step from `## Goal`, `## Knowledge`, and `## Progress`. Ask the user when no safe next step is clear.
6. Do the requested task work.
7. After the work, update the task doc in this order:
   - `Worklog`: add a new record describing what changed, what was learned, files touched, blockers, and follow-up.
   - `Knowledge`: rewrite the section from current information. Remove unnecessary parts, fix inaccurate parts, and add missing durable facts, assumptions, constraints, or decisions.
   - `Progress`: rewrite the section from current information. Remove unnecessary parts, fix inaccurate parts, and add the latest completed work, active work, blockers, and next likely move.
   - `TODO`: rewrite the active queue from current information. Remove unnecessary items, fix inaccurate items, add missing next actions, and keep only active actionable work.
   - `Archived`: update based on the doc changes. Move completed, dropped, superseded, or stale TODO/knowledge/progress content here instead of silently deleting meaningful history.
8. Keep the task doc as the durable state, not a separate checklist.

## Action: Revisit / Refine

Use `--revisit` to refresh an existing task doc when its information may be stale, incomplete, or inaccurate. Do not execute task work during revisit; only modify the task doc.

Workflow:

1. Select the relevant existing task doc. If no doc is clearly selected, search `.noisy_room/tasks/*.markdown` and ask the user to choose when needed.
2. Read the entire task doc before editing it.
3. Normalize it to the mandatory task document contract if needed.
4. Treat the existing doc as possibly stale or inaccurate. Compare it against the user's latest prompt and any directly relevant repo context.
5. Update `Knowledge` from current information. Remove unnecessary parts, fix inaccurate parts, and add missing durable facts, assumptions, constraints, or decisions.
6. Update `Progress` from current information. Remove unnecessary parts, fix inaccurate parts, and add the latest accurate task state, blockers, and next likely move.
7. Rewrite `TODO` from current information. Remove unnecessary items, fix inaccurate items, add missing next actions, and keep only active actionable work.
8. Update `Archived` based on the doc changes. Move meaningful removed, superseded, or stale TODO/knowledge/progress content here instead of silently deleting it.
9. Ask targeted questions only when the doc and current information conflict in a way that cannot be resolved from the repo or prompt.
10. Report the task doc path and summarize the doc-only changes.
