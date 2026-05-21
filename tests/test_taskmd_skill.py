from __future__ import annotations

from tests.harness import (
    assert_new_task_doc_side_effects,
    assert_noisy_taskmd_discovered,
    assert_skill_symlink_wired,
    validate_single_new_task_doc,
)


SOURCE_BRIEF = """# CSV Import Command

Create a task plan for adding a CSV import command to a small Python CLI.

Stable facts:
- The command should read a CSV file path from the command line.
- The future implementation should validate required columns before importing rows.
- The first next action should inspect the existing CLI entry points.
- This source file is a reference-only input and must not be modified.
- This test is only about creating the task document; do not implement the command.
"""


BAD_TASK_DOC = """# Unrelated Work

## Goal

Write a dinner recipe unrelated to CSV imports.

## Knowledge

No source references are needed.

## Progress

The CSV command has already been implemented.

## Worklog

### 2026-05-20 00:00:00 UTC - Implemented command

```jsonl
{ "agent_cli": "codex-cli", "session_id": "bad", "worklog_id": "bad-work", "trigger": "todo" }
```

Implemented the CSV command instead of only creating a task doc.

## Archived

## TODO

### 2026-05-20 00:00:00 UTC - Edit source brief

```jsonl
{ "agent_cli": "codex-cli", "session_id": "bad" }
```

Edit source.md to match the completed implementation.
"""


def test_noisy_taskmd_is_discoverable(test_run_factory) -> None:
    run = test_run_factory("discovery")
    assert_skill_symlink_wired(run.workspace)

    result = run.run_command(
        ["codex", "debug", "prompt-input", "test skill discovery"],
        label="skill-discovery",
    )

    assert_noisy_taskmd_discovered(result)


def test_noisy_taskmd_new_creates_task_doc_from_source(test_run_factory) -> None:
    run = test_run_factory("new-task-doc")
    source = run.write_source("source.md", SOURCE_BRIEF)
    before = run.workspace_file_hashes()
    prompt = (
        "$noisy:taskmd --new create a task doc using source.md as reference. "
        "Treat source.md as reference-only and do not modify it. "
        "Only create the task document; do not implement the described work."
    )
    creator_output = run.artifacts / "creator-last-message.txt"

    result = run.codex_exec(
        prompt,
        label="codex-new-task-doc",
        output_last_message=creator_output,
    )

    result.assert_success()
    task_doc = validate_single_new_task_doc(run.workspace, source_name="source.md")
    assert_new_task_doc_side_effects(run, before=before, task_doc=task_doc)
    verifier_result = run.verify_new_task_doc_semantics(source=source, task_doc=task_doc)

    assert verifier_result["passed"], (
        "Codex verifier rejected the generated task doc:\n"
        f"Summary: {verifier_result['summary']}\n"
        f"Issues: {verifier_result['issues']}"
    )


def test_codex_verifier_rejects_bad_task_doc(test_run_factory) -> None:
    run = test_run_factory("bad-verifier-control")
    source = run.write_source("source.md", SOURCE_BRIEF)
    bad_task_doc = run.write_source(".noisy_room/tasks/bad-task.md", BAD_TASK_DOC)

    verifier_result = run.verify_new_task_doc_semantics(source=source, task_doc=bad_task_doc)

    assert not verifier_result["passed"], (
        "Codex verifier accepted a deliberately invalid task doc:\n"
        f"Summary: {verifier_result['summary']}\n"
        f"Issues: {verifier_result['issues']}"
    )
