from __future__ import annotations

import os

import pytest

from tests.harness import (
    GEMINI_YOLO_STREAM_PROFILE,
    assert_gemini_stream_invoked_subagent,
    assert_roadmap_entries_have_required_shape,
    gemini_stream_assistant_text,
    gemini_stream_events,
    metadata_records,
)


pytestmark = pytest.mark.live_gemini


CONTINUE_SUBAGENTS_TASK_DOC = """# Gemini Continue Subagent Coverage

## Goal

Verify Action Continue executes compatible parallel Roadmap items through subagents and records the completed task work.

## Knowledge

This fixture intentionally contains two independent Roadmap items with disjoint write scopes. R001 writes only `alpha.txt`; R002 writes only `beta.txt`. Continue should dispatch one subagent for each compatible item when subagents are available.

## Worklog

### 2026-05-20 00:00:00 UTC - Seed task doc

```jsonl
{ "agent": "codex-cli", "session_id": "seed", "worklog_id": "seed-worklog", "trigger": "revisit" }
```

Seeded this task doc for Gemini CLI Continue subagent coverage.

## Archived

## Roadmap

### R001 - Write alpha marker

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": ["R002"], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: This item has a separate write scope from R002, so it can run in the same subagent wave.

Task: Create `alpha.txt` containing exactly `alpha subagent completed`.

### R002 - Write beta marker

```jsonl
{ "id": "R002", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": ["R001"], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: This item has a separate write scope from R001, so it can run in the same subagent wave.

Task: Create `beta.txt` containing exactly `beta subagent completed`.
"""


@pytest.mark.skipif(
    os.environ.get("NOISY_RUN_GEMINI_E2E") != "1",
    reason="set NOISY_RUN_GEMINI_E2E=1 to run live Gemini model behavior",
)
def test_gemini_noisy_taskmd_continue_parallel_items_use_subagents(test_run_factory) -> None:
    run = test_run_factory("gemini-continue-subagents")
    task_doc = run.write_source(
        ".noisy_room/tasks/gemini-continue-subagents.md",
        CONTINUE_SUBAGENTS_TASK_DOC,
    )
    before = run.workspace_file_hashes()
    before_worklog_count = len(metadata_records(task_doc, "Worklog"))
    prompt = (
        "/noisy:tmd -c .noisy_room/tasks/gemini-continue-subagents.md "
        "continue from this task doc. The two active Roadmap items are compatible, list each "
        "other in parallels, and have disjoint write scopes. Follow Action: Continue exactly: "
        "launch one built-in generalist subagent for R001 and one built-in generalist subagent "
        "for R002 in the same parallel wave. If Gemini CLI cannot start those subagents, fail "
        "clearly and do not create the marker files. If successful, append a Worklog entry "
        "whose prose includes the exact phrase 'continue subagent delegation used'. In your "
        "final answer include exactly 'CONTINUE_SUBAGENT_DELEGATION: used'."
    )

    result = run.gemini_exec(
        prompt,
        label="gemini-continue-subagents",
        profile=GEMINI_YOLO_STREAM_PROFILE,
    )

    result.assert_success()
    events = gemini_stream_events(result)
    assert_gemini_stream_invoked_subagent(events, agent_name="generalist", min_count=2)
    transcript = f"{gemini_stream_assistant_text(events)}\n{result.stderr}".lower()
    assert "continue_subagent_delegation: used" in transcript, (
        "Gemini final output should confirm the Continue subagents ran"
    )
    task_doc_text = task_doc.read_text(encoding="utf-8")
    assert "continue subagent delegation used" in task_doc_text.lower(), (
        "Continue Worklog should record that subagent delegation was used"
    )
    assert "subagent delegation unavailable" not in transcript
    assert "cannot start" not in transcript

    assert (run.workspace / "alpha.txt").read_text(encoding="utf-8").strip() == (
        "alpha subagent completed"
    )
    assert (run.workspace / "beta.txt").read_text(encoding="utf-8").strip() == (
        "beta subagent completed"
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
