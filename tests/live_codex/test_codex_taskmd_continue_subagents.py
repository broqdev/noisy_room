from __future__ import annotations

import pytest

from tests.harness import (
    CODEX_JSON_PROFILE,
    assert_codex_stream_spawned_subagents,
    assert_roadmap_entries_have_required_shape,
    codex_stream_assistant_text,
    codex_stream_events,
    metadata_records,
)


pytestmark = pytest.mark.live_codex


CONTINUE_SUBAGENTS_TASK_DOC = """# Codex Continue Subagent Coverage

## Goal

Verify Action Continue executes compatible parallel Roadmap items through Codex CLI subagents and records the completed task work.

## Knowledge

This fixture intentionally contains two independent Roadmap items with disjoint write scopes. R001 writes only `alpha.txt`; R002 writes only `beta.txt`. Continue should dispatch one subagent for each compatible item when subagents are available.

## Worklog

### 2026-05-20 00:00:00 UTC - Seed task doc

```jsonl
{ "agent": "codex-cli", "session_id": "seed", "worklog_id": "seed-worklog", "trigger": "revisit" }
```

Seeded this task doc for Codex CLI Continue subagent coverage.

## Archived

## Roadmap

### R001 - Write alpha marker

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": ["R002"], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: This item has a separate write scope from R002, so it can run in the same subagent wave.

Task: Create `alpha.txt` containing exactly `alpha codex subagent completed`.

### R002 - Write beta marker

```jsonl
{ "id": "R002", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": ["R001"], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: This item has a separate write scope from R001, so it can run in the same subagent wave.

Task: Create `beta.txt` containing exactly `beta codex subagent completed`.
"""


def test_codex_noisy_taskmd_continue_parallel_items_use_subagents(test_run_factory) -> None:
    run = test_run_factory("codex-continue-subagents")
    task_doc = run.write_source(
        ".noisy_room/tasks/codex-continue-subagents.md",
        CONTINUE_SUBAGENTS_TASK_DOC,
    )
    before = run.workspace_file_hashes()
    before_worklog_count = len(metadata_records(task_doc, "Worklog"))
    prompt = (
        "$noisy:tmd -c .noisy_room/tasks/codex-continue-subagents.md "
        "continue from this task doc. The two active Roadmap items are compatible, list each "
        "other in parallels, and have disjoint write scopes. Follow Action: Continue exactly: "
        "launch one Codex subagent for R001 and one Codex subagent for R002 in the same "
        "parallel wave. If Codex CLI cannot start those subagents, fail clearly and do not "
        "create the marker files. If successful, append a Worklog entry whose prose includes "
        "the exact phrase 'codex continue subagent delegation used'. In your final answer "
        "include exactly 'CODEX_CONTINUE_SUBAGENT_DELEGATION: used'."
    )

    result = run.codex_exec(
        prompt,
        label="codex-continue-subagents",
        profile=CODEX_JSON_PROFILE,
    )

    result.assert_success()
    events = codex_stream_events(result)
    assert_codex_stream_spawned_subagents(events, min_count=2)
    transcript = f"{codex_stream_assistant_text(events)}\n{result.stderr}".lower()
    assert "codex_continue_subagent_delegation: used" in transcript, (
        "Codex final output should confirm the Continue subagents ran"
    )
    task_doc_text = task_doc.read_text(encoding="utf-8")
    assert "codex continue subagent delegation used" in task_doc_text.lower(), (
        "Continue Worklog should record that Codex subagent delegation was used"
    )
    assert "subagent delegation unavailable" not in transcript
    assert "cannot start" not in transcript

    assert (run.workspace / "alpha.txt").read_text(encoding="utf-8").strip() == (
        "alpha codex subagent completed"
    )
    assert (run.workspace / "beta.txt").read_text(encoding="utf-8").strip() == (
        "beta codex subagent completed"
    )

    worklog_metadata = metadata_records(task_doc, "Worklog")
    assert len(worklog_metadata) > before_worklog_count, "Continue should append a Worklog entry"
    assert worklog_metadata[-1].get("trigger") == "roadmap", (
        f"Latest Worklog entry should be a Continue task-work record: {worklog_metadata[-1]}"
    )
    assert_roadmap_entries_have_required_shape(
        task_doc_text.splitlines(),
        allow_empty=True,
    )

    after = run.workspace_file_hashes()
    task_doc_rel = task_doc.relative_to(run.workspace).as_posix()
    added = set(after) - set(before)
    removed = set(before) - set(after)
    changed = {path for path in set(before) & set(after) if before[path] != after[path]}
    assert added == {"alpha.txt", "beta.txt"}, (
        f"Continue should only add marker files; added {sorted(added)}"
    )
    assert removed == set(), f"Continue should not remove workspace files: {sorted(removed)}"
    assert changed == {task_doc_rel}, (
        f"Continue should only update the task doc; changed {sorted(changed)}"
    )
