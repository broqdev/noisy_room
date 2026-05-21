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
{ "agent": "codex-cli", "session_id": "bad", "worklog_id": "bad-work", "trigger": "todo" }
```

Implemented the CSV command instead of only creating a task doc.

## Archived

## TODO

### 2026-05-20 00:00:00 UTC - Edit source brief

```jsonl
{ "agent": "codex-cli", "session_id": "bad" }
```

Edit source.md to match the completed implementation.
"""
