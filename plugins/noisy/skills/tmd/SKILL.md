---
name: tmd
description: Use one markdown task document under `.noisy_room/tasks/*.md` as durable task state. Use for `$noisy:tmd`, create, continue, revisit, or track task-doc work. Supports `-n`/`--new`, `-c`/`--continue`, `-rv`/`--revisit`, and `--revisit-n` with a non-negative integer.
---

# Task Markdown

## Purpose

Use one `.noisy_room/tasks/*.md` task doc as durable state.

## Dispatch

Parse options and action flags before choosing an action:

- `-n` / `--new`: create a task doc from the prompt and referenced source docs.
- `-c` / `--continue`: work from an existing task doc.
- `-rv` / `--revisit`: refresh an existing task doc without task work. Treat `-rv` as one exact alias, not combined short flags.
- `--revisit-n <N>`: override the auto-revisit threshold. Use a non-negative integer; `0` means always revisit before inferred continue.

Default auto-revisit threshold: 5 Worklog records after the latest `trigger: "revisit"` record.

Report unsupported flags. If supported action flags conflict after alias normalization, ask the user to choose one.

When no flag is present, infer intent:

- `create`, `new`, `start`, or `make a task doc` -> `--new`.
- `continue`, `resume`, `work on`, or `advance the task from its Roadmap` -> `--continue`.
- `revisit`, `refresh`, `review`, or `update the doc` -> `--revisit`.
- No prompt -> `--continue`.
- Unclear prompt -> search `.noisy_room/tasks/*.md`; if none match, use `--new`; if matches remain, ask whether to create, continue one, or revisit one.

For inferred `--continue`, resolve the task doc, count Worklog records after the latest `trigger: "revisit"` record, and compare to the threshold. If no revisit record exists, the doc is due. If due, run `Action: Revisit`, then immediately run `Action: Continue` on the refreshed doc. A due Revisit is mandatory doc-only work; unavailable, disallowed, unsafe, or declined subagent delegation is not a blocker and must not skip Revisit.

Read referenced files before acting. If a referenced file is missing, ask for the correct path.

## Related Skill Use

Use related skills when they help with the prompt, referenced files, doc refresh, or selected Roadmap work. Prefer the most specific matching skill and keep action boundaries: `New` and `Revisit` stay doc-only; `Continue` may use skills for task work.

## Task Document Contract

Every task doc must use exactly this top-level structure and order. Normalize older or malformed docs before using them as state.

````markdown
# <Task Title>

## Goal

<Desired outcome, including important non-goals.>

## Knowledge

<Durable facts, assumptions, constraints, decisions, and useful references.>

## Worklog

### <YYYY-MM-DD HH:mm:ss UTC> - <Short summary>

```jsonl
{ "agent": "codex-cli", "session_id": "<session-id>", "worklog_id": "<generated-unique-id>", "trigger": "<roadmap|revisit>" }
```

<Session delta: actions taken, findings, decisions, files touched, blockers, follow-up, and meaningful removals.>

## Archived

### <YYYY-MM-DD HH:mm:ss UTC> - <Completed or deprecated Roadmap Item summary>

```jsonl
{ "type": "roadmap", "id": "R9A3F0C-001", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "<session-id>" }
```

<The completed/deprecated Roadmap Item content, why it left active Roadmap, and what replaced it if anything.>

## Roadmap

<Roadmap note: General guidance for how to work the Roadmap Items below. Use `(no more tasks)` when the Goal is achieved and no more task is needed.>

### R9A3F0C-001 - <Short action summary>

```jsonl
{ "id": "R9A3F0C-001", "created_at": "<YYYY-MM-DD HH:mm:ss UTC>", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "<session-id>" }
```

Rationale: <Why this is the right next task now.>

Task: <Concrete next action and observable completion condition.>
````

Rules:

- Keep the exact top-level sections. Each Worklog, Archived, and Roadmap entry gets one single-line fenced `jsonl` metadata object after its heading.
- Keep `Knowledge` short and current; record meaningful removals/replacements in `Worklog`. Keep `Worklog` and `Archived` append-only except malformed metadata/typos.
- Worklog metadata needs stable `worklog_id`; use `trigger: "roadmap"` for active-Roadmap task work and `"revisit"` for doc-only creation/review/research.
- `Archived` stores only completed or deprecated Roadmap Items, never Knowledge history or general notes. Archived roadmap metadata needs `type: "roadmap"`, matching `id`, `deps`, `parallels`, `agent`, and `session_id`; preserve the Roadmap ID and omit active-item `created_at`.
- Begin `Roadmap` with one concise note paragraph, not an item heading or metadata. Use `(no more tasks)` only when the Goal is achieved and no active Roadmap items remain; otherwise preserve or improve the note during `Continue` and `Revisit`.
- Keep active Roadmap items that still represent useful future work or ordering context, including unselected items. Move completed/deprecated items to `Archived` after summarizing the change in `Worklog`.
- Active Roadmap item metadata needs matching `id`, UTC `created_at`, `deps`, and `parallels`; `deps` and `parallels` are arrays of Roadmap IDs. Treat `deps` as ordering context and `parallels` as compatible same-wave work.
- Active Roadmap item bodies use non-empty `Rationale:` then `Task:`. Do not put those fields in metadata.
- New Roadmap IDs use `R<DOCKEY>-<NNN>` such as `R9A3F0C-001`. Derive `DOCKEY` from `sha256("<initial or earliest Worklog created_at UTC>\n<task-doc slug-or-title>")[:6].upper()`. For docs without this ID shape, use the key only for new IDs.
- For new IDs, choose the next `NNN` after the largest matching ID already present in active Roadmap or Archived metadata.
- Roadmap ID means the entire stored ID string from the heading and metadata, including the `R<DOCKEY>-` prefix when present. Copy it exactly in status updates, final responses, Worklog, Archived, `deps`, `parallels`, and subagent prompts; do not abbreviate `R9A3F0C-004` to `R004`, `004`, or "the R004 direction". Legacy `R001` is acceptable only when the item itself is exactly `R001`.

## Existing Task Doc Baseline

For `Continue` and `Revisit`, establish this baseline first:

1. Resolve and verify the target from an explicit task-doc path, open/current doc, recently mentioned doc, or search `.noisy_room/tasks/*.md`; ask only if still unclear.
2. Normalize only useful contract gaps: top-level order, metadata, Roadmap note, and active Roadmap item shape. Carry current durable facts into `Knowledge`, completed/deprecated Roadmap records into `Archived`, and future work into `Roadmap`; summarize meaningful removals in the next `Worklog`.
3. Build state from `Goal`, `Knowledge`, recent `Worklog`, `Archived`, and active `Roadmap`. Do not revive completed/deprecated work unless current evidence makes it relevant again.

## Existing Task Doc Update Order

When updating an existing task doc after `Continue` or `Revisit`:

1. Append a `Worklog` record with the correct `trigger`.
2. In that record, summarize task work, doc-only changes, completed/deprecated Roadmap Items, meaningful removals, and stale Knowledge changes.
3. Move completed/deprecated Roadmap Items from active `Roadmap` into `Archived`.
4. Refresh `Knowledge`, the Roadmap note, and the full Roadmap set. Preserve still-relevant items, update incomplete items in place, remove completed/deprecated items from active `Roadmap`, add new items for split tracks, or set the note to `(no more tasks)` when the Goal is achieved and no active items remain.

## Action: New

Create a task doc only; do not execute task work.

1. Require enough prompt/source material to name the task and infer a goal. Ask if missing.
2. Read referenced files as reference-only inputs; do not modify them.
3. Create `.noisy_room/tasks/` if needed.
4. Choose a concise lowercase hyphenated slug and create a new `.md` file without overwriting an existing file.
5. Fill the mandatory contract:
   - `Goal`: requested outcome and non-goals.
   - `Knowledge`: stable facts, assumptions, constraints, decisions, references, and reference-only source docs that must not be modified unless scope expands.
   - `Worklog`: initial creation record with `trigger: "revisit"`, mentioning referenced source docs.
   - `Archived`: empty unless source material explicitly contains completed/deprecated Roadmap records.
   - `Roadmap`: short Roadmap note, then at least the first Roadmap item with a new Roadmap ID, `created_at`, `deps: []`, `parallels: []`, `Rationale:`, and `Task:`. Add multiple Roadmap items and reciprocal `parallels` when independent tracks are clear. Do not include editing source files unless explicitly requested.
6. Report the created task doc path and full Roadmap IDs created.

## Action: Continue

Work from an existing task doc, then update it.

1. Establish `Existing Task Doc Baseline`.
2. Choose the execution set by scanning every active Roadmap item for a useful parallel execution wave. Start with the highest-priority item that advances `Goal` unless the user selected another item. Include relevant, compatible `parallels` items and other independent items not blocked by `deps`. Treat unchosen items as context to preserve or update, not stale content. If Roadmap has no active items and note is `(no more tasks)`, report the Goal already achieved. If Roadmap is otherwise empty, infer the next step or ask if unclear.
3. Do the task work using the task doc as durable state. Invoking `Action: Continue` selects a compatible execution wave from active Roadmap Items. Prefer first-class subagent delegation only when the current runtime exposes a reliable subagent primitive and the selected items have safe, disjoint write scopes. If first-class delegation is unavailable, unreliable, unsafe, or declined, execute the selected wave locally while keeping item scopes explicit; do not pretend delegation occurred. Do not collapse independent selected Roadmap Items into an untracked blob of work: name each selected item by full Roadmap ID, complete what is safe, preserve blocked or unfinished items, and record the actual execution mode in `Worklog`.
4. Apply `Existing Task Doc Update Order` with `trigger: "roadmap"`. Worklog must state whether selected Roadmap Items were completed by first-class subagents, local execution, or a fallback path, and name each selected Roadmap Item that completed or became deprecated by full Roadmap ID. Archived must receive each completed/deprecated selected Roadmap Item. Active Roadmap must keep every still-relevant unselected item, remove every completed selected Roadmap Item, revise selected items that remain relevant but incomplete, remove other deprecated items, add next items for split tracks, or set `(no more tasks)` when complete.
5. Keep the task doc as durable state, not a separate checklist. Report the task doc path and selected, completed, blocked, or remaining Roadmap Items by full Roadmap ID.

## Action: Revisit

Refresh an existing task doc only; do not execute task work.

1. Establish `Existing Task Doc Baseline`.
2. Prefer one subagent run when delegation is available, safe, and allowed. Give it the task doc path, baseline summary, latest prompt, referenced files, consult-only skill guidance already read, and these Revisit rules. If delegation is unavailable, disallowed, unsafe, or declined, complete the same Revisit locally instead of blocking. In either path, stay doc-only.
3. Review and audit whole doc. Use the checks/research below, then apply `Existing Task Doc Update Order` with `trigger: "revisit"` and no task work: optimize `Knowledge`, optimize `Roadmap`, move completed/deprecated Roadmap Items to `Archived`, and summarize audit, research, doc-only changes, and meaningful removals in `Worklog`.
4. Check common issues before editing:
   - Goal Drift: Roadmap items that no longer advance `Goal`, widen scope without a user decision, or follow side paths.
   - Loopholes: looped (or repeated) path in Worklogs or Roadmap items.
   - Stale state: outdated `Knowledge`, completed/deprecated Roadmap items, missing constraints, or unresolved uncertainty.
5. Favor web research when current external facts could affect `Goal`, `Knowledge`, or `Roadmap`, and whenever the user asks. Use current-date searches, prefer dated official docs/repos/releases/changelogs/issues/substantive articles, and verify dates before changing assumptions or Roadmap items.
6. Ask targeted questions only when prompt, files, repo, or research cannot resolve conflicts.
7. If a subagent ran, review its result. Always verify the task doc still follows the contract, then report the task doc path and doc-only changes, including full Roadmap IDs for changed Roadmap Items.
