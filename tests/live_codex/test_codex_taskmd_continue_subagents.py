from __future__ import annotations

import pytest

from tests.harness import (
    CODEX_JSON_PROFILE,
    assert_roadmap_entries_have_required_shape,
    codex_stream_assistant_text,
    codex_stream_events,
    metadata_records,
)


pytestmark = pytest.mark.live_codex


CONTINUE_EXECUTION_WAVE_TASK_DOC = """# Codex Continue Execution Wave Coverage

## Goal

Verify Action Continue executes compatible parallel Roadmap items as one execution wave and records the actual execution mode.

## Knowledge

This fixture intentionally contains two independent Roadmap items with disjoint write scopes. R001 writes only `alpha.txt`; R002 writes only `beta.txt`. Continue should select both items in one compatible execution wave. First-class subagents may be used only when the runtime exposes reliable delegation; otherwise local execution is acceptable when Worklog records the actual mode.

## Worklog

### 2026-05-20 00:00:00 UTC - Seed task doc

```jsonl
{ "agent": "codex-cli", "session_id": "seed", "worklog_id": "seed-worklog", "trigger": "revisit" }
```

Seeded this task doc for Codex CLI Continue execution-wave coverage.

## Archived

## Roadmap

Work the Roadmap Items below in the same execution wave when their metadata and write scopes remain compatible.

### R001 - Write alpha marker

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": ["R002"], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: This item has a separate write scope from R002, so it can run in the same execution wave.

Task: Create `alpha.txt` containing exactly `alpha codex subagent completed`.

### R002 - Write beta marker

```jsonl
{ "id": "R002", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": ["R001"], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: This item has a separate write scope from R001, so it can run in the same execution wave.

Task: Create `beta.txt` containing exactly `beta codex subagent completed`.
"""


def test_codex_noisy_taskmd_continue_parallel_items_complete_execution_wave(test_run_factory) -> None:
    run = test_run_factory("codex-continue-execution-wave")
    task_doc = run.write_source(
        ".noisy_room/tasks/codex-continue-execution-wave.md",
        CONTINUE_EXECUTION_WAVE_TASK_DOC,
    )
    before = run.workspace_file_hashes()
    before_worklog_count = len(metadata_records(task_doc, "Worklog"))
    prompt = (
        "$noisy:tmd -c .noisy_room/tasks/codex-continue-execution-wave.md "
        "continue from this task doc. The two active Roadmap items are compatible, list each "
        "other in parallels, and have disjoint write scopes. Follow Action: Continue exactly: "
        "select R001 and R002 as one compatible execution wave. Use first-class Codex "
        "subagents only if the runtime exposes reliable subagent delegation; otherwise "
        "execute the selected wave locally without pretending delegation occurred. If "
        "successful, append a Worklog entry whose prose includes the exact phrase "
        "'codex continue execution wave used' and an 'Execution mode:' sentence. In your "
        "final answer include exactly 'CODEX_CONTINUE_EXECUTION_WAVE: completed'."
    )

    result = run.codex_exec(
        prompt,
        label="codex-continue-execution-wave",
        profile=CODEX_JSON_PROFILE,
    )

    result.assert_success()
    events = codex_stream_events(result)
    transcript = f"{codex_stream_assistant_text(events)}\n{result.stderr}".lower()
    assert "codex_continue_execution_wave: completed" in transcript, (
        "Codex final output should confirm the Continue execution wave completed"
    )
    task_doc_text = task_doc.read_text(encoding="utf-8")
    assert "codex continue execution wave used" in task_doc_text.lower(), (
        "Continue Worklog should record that the Codex execution wave was used"
    )
    assert "execution mode:" in task_doc_text.lower(), (
        "Continue Worklog should record the actual execution mode"
    )

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
