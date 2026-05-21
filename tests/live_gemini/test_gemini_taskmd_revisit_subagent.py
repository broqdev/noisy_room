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


REVISIT_SUBAGENT_TASK_DOC = """# Gemini Revisit Subagent Coverage

## Goal

Keep a task doc current while verifying Gemini CLI follows the Revisit subagent requirement.

## Knowledge

The Revisit action must refresh the task doc only after the current agent establishes the baseline and delegates the remaining Revisit work to one subagent run.

## Worklog

### 2026-05-20 00:00:00 UTC - Seed task doc

```jsonl
{ "agent": "codex-cli", "session_id": "seed", "worklog_id": "seed-worklog", "trigger": "revisit" }
```

Seeded this task doc for Gemini CLI Revisit coverage.

## Archived

## Roadmap

### R001 - Refresh stale planning state

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: The seeded state exists to exercise the Revisit path, not to execute task work.

Task: Refresh this task doc only after the required Revisit subagent reviews the whole document.
"""


@pytest.mark.skipif(
    os.environ.get("NOISY_RUN_GEMINI_E2E") != "1",
    reason="set NOISY_RUN_GEMINI_E2E=1 to run live Gemini model behavior",
)
def test_gemini_noisy_taskmd_revisit_uses_required_subagent(test_run_factory) -> None:
    run = test_run_factory("gemini-revisit-subagent")
    task_doc = run.write_source(
        ".noisy_room/tasks/gemini-revisit-subagent.md",
        REVISIT_SUBAGENT_TASK_DOC,
    )
    before = run.workspace_file_hashes()
    before_worklog_count = len(metadata_records(task_doc, "Worklog"))
    prompt = (
        "/noisy:tmd -rv .noisy_room/tasks/gemini-revisit-subagent.md "
        "refresh this task doc only. The Revisit action requires the current agent to establish "
        "the baseline, then execute the remaining Revisit work in one subagent run. Use the "
        "built-in generalist subagent for that required run. If Gemini CLI cannot start that "
        "subagent, fail clearly and do not edit the task doc. If successful, append a Worklog "
        "entry whose prose includes the exact phrase 'subagent delegation used'. In your final "
        "answer include exactly "
        "'SUBAGENT_DELEGATION: used'."
    )

    result = run.gemini_exec(
        prompt,
        label="gemini-revisit-subagent",
        profile=GEMINI_YOLO_STREAM_PROFILE,
    )

    result.assert_success()
    events = gemini_stream_events(result)
    assert_gemini_stream_invoked_subagent(events, agent_name="generalist")
    transcript = f"{gemini_stream_assistant_text(events)}\n{result.stderr}".lower()
    assert "subagent_delegation: used" in transcript, (
        "Gemini final output should confirm the required Revisit subagent ran"
    )
    assert "subagent delegation used" in task_doc.read_text(encoding="utf-8").lower(), (
        "Revisit Worklog should record that subagent delegation was used"
    )
    assert "subagent delegation unavailable" not in transcript
    assert "cannot start a subagent" not in transcript

    worklog_metadata = metadata_records(task_doc, "Worklog")
    assert len(worklog_metadata) > before_worklog_count, "Revisit should append a Worklog entry"
    assert worklog_metadata[-1].get("trigger") == "revisit", (
        f"Latest Worklog entry should be a Revisit record: {worklog_metadata[-1]}"
    )
    assert_roadmap_entries_have_required_shape(
        task_doc.read_text(encoding="utf-8").splitlines(),
        allow_empty=True,
    )

    after = run.workspace_file_hashes()
    task_doc_rel = task_doc.relative_to(run.workspace).as_posix()
    added = set(after) - set(before)
    removed = set(before) - set(after)
    changed = {path for path in set(before) & set(after) if before[path] != after[path]}
    assert added == set(), f"Revisit should not add workspace files: {sorted(added)}"
    assert removed == set(), f"Revisit should not remove workspace files: {sorted(removed)}"
    assert changed == {task_doc_rel}, (
        f"Revisit should only update the task doc; changed {sorted(changed)}"
    )
