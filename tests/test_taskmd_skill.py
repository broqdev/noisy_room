from __future__ import annotations

import os
import tomllib

import pytest

from tests.harness import (
    TASKMD_RT_SKILL_DIR,
    TASKMD_RT_RUNNER,
    assert_gemini_taskmd_discovered,
    assert_gemini_taskmd_wired,
    assert_new_task_doc_side_effects,
    assert_noisy_taskmd_discovered,
    assert_skill_symlink_wired,
    assert_taskmd_rt_discovered,
    assert_taskmd_rt_skill_wired,
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


ROUND_TABLE_TASK_DOC = """# CSV Import Command

## Goal

Add CSV import planning.

## Knowledge

source.md is reference-only.

## Progress

Ready for the next roundtable handoff.

## Worklog

### 2026-05-20 00:00:00 UTC - Codex planned import

```jsonl
{ "agent": "$agent", "session_id": "rt", "worklog_id": "rt-work", "trigger": "todo" }
```

Prepared the next handoff.

## Archived

## TODO

### 2026-05-20 00:00:00 UTC - Continue import planning

```jsonl
{ "agent": "$agent", "session_id": "rt" }
```

Continue from the active TODO.
"""


def _write_fake_agent_script(test_run, name: str, *, agent: str, worklog_id: str | None) -> str:
    if worklog_id is None:
        script = """#!/usr/bin/env bash
set -euo pipefail
exit 0
"""
    else:
        script = f"""#!/usr/bin/env bash
set -euo pipefail
: "${{TASK_DOC_UNDER_TEST:?}}"
entry_file="$(mktemp)"
tmp_file="$(mktemp)"
cat > "$entry_file" <<'ENTRY'
### 2026-05-20 00:00:00 UTC - Fake {agent} turn

```jsonl
{{ "agent": "{agent}", "session_id": "fake", "worklog_id": "{worklog_id}", "trigger": "todo" }}
```

Fake {agent} update.

ENTRY
awk 'NR==FNR {{ entry = entry $0 ORS; next }} /^## Archived$/ && inserted == 0 {{ printf "%s", entry; inserted = 1 }} {{ print }} END {{ if (inserted == 0) printf "%s", entry }}' "$entry_file" "$TASK_DOC_UNDER_TEST" > "$tmp_file"
mv "$tmp_file" "$TASK_DOC_UNDER_TEST"
rm -f "$entry_file"
"""

    path = test_run.write_source(f"bin/{name}", script)
    os.chmod(path, 0o755)
    return str(path)


def test_noisy_taskmd_is_discoverable(test_run_factory) -> None:
    run = test_run_factory("discovery")
    assert_skill_symlink_wired(run.workspace)

    result = run.run_command(
        ["codex", "debug", "prompt-input", "test skill discovery"],
        label="skill-discovery",
    )

    assert_noisy_taskmd_discovered(result)


def test_noisy_taskmd_rt_is_discoverable(test_run_factory) -> None:
    run = test_run_factory("rt-discovery")
    assert_taskmd_rt_skill_wired(run.workspace)

    result = run.run_command(
        ["codex", "debug", "prompt-input", "test skill discovery"],
        label="rt-skill-discovery",
    )

    assert_taskmd_rt_discovered(result)


def test_taskmd_rt_runtime_uses_bash_not_python() -> None:
    runner = TASKMD_RT_RUNNER.read_text()
    skill = (TASKMD_RT_SKILL_DIR / "SKILL.md").read_text()

    assert runner.startswith("#!/usr/bin/env bash")
    assert "python" not in runner.lower()
    assert "python" not in skill.lower()


def test_gemini_taskmd_wiring_uses_command_wrapper(test_run_factory) -> None:
    run = test_run_factory("gemini-wiring")
    assert_gemini_taskmd_wired(run.workspace)

    command_path = run.workspace / ".gemini" / "commands" / "noisy" / "taskmd.toml"
    command = tomllib.loads(command_path.read_text(encoding="utf-8"))

    description = command.get("description")
    prompt = command.get("prompt")
    assert isinstance(description, str) and description.strip(), "Gemini command needs a description"
    assert isinstance(prompt, str), "Gemini command needs a prompt"
    assert "taskmd" in prompt, "Command should name the Gemini Agent Skill"
    assert "/noisy:taskmd" in prompt, "Command should preserve the namespaced user invocation"
    assert "{{args}}" in prompt, "Command should pass user arguments through"
    assert "!{" not in prompt, "Command should not use shell injection"


def test_gemini_taskmd_is_discoverable(test_run_factory) -> None:
    run = test_run_factory("gemini-discovery")
    assert_gemini_taskmd_wired(run.workspace)

    result = run.run_command(
        ["gemini", "skills", "list", "--all"],
        label="gemini-skill-discovery",
        env={"GEMINI_CLI_TRUST_WORKSPACE": "true"},
    )

    assert_gemini_taskmd_discovered(result)


def test_taskmd_rt_routes_codex_latest_to_gemini_then_codex(test_run_factory) -> None:
    run = test_run_factory("rt-codex-latest")
    task_doc = run.write_source(
        ".noisy_room/tasks/csv-import.md",
        ROUND_TABLE_TASK_DOC.replace("$agent", "codex-cli"),
    )

    result = run.run_command(
        [
            "bash",
            str(TASKMD_RT_RUNNER),
            "--workspace",
            str(run.workspace),
            "--task-doc",
            task_doc.relative_to(run.workspace).as_posix(),
            "--r",
            "1",
            "--dry-run",
            "--",
            "continue from the active TODO",
        ],
        label="rt-codex-latest-dry-run",
    )

    result.assert_success()
    assert "rounds=1" in result.stdout
    assert "task_doc=.noisy_room/tasks/csv-import.md" in result.stdout
    assert "call_1_agent=gemini-cli" in result.stdout
    assert "call_2_agent=codex-cli" in result.stdout
    assert "/noisy:taskmd .noisy_room/tasks/csv-import.md continue from the active TODO" in result.stdout
    assert "$noisy:taskmd .noisy_room/tasks/csv-import.md continue from the active TODO" in result.stdout
    assert '"agent": "gemini-cli"' in result.stdout
    assert '"agent": "codex-cli"' in result.stdout


def test_taskmd_rt_routes_gemini_latest_to_codex_then_gemini(test_run_factory) -> None:
    run = test_run_factory("rt-gemini-latest")
    task_doc = run.write_source(
        ".noisy_room/tasks/csv-import.md",
        ROUND_TABLE_TASK_DOC.replace("$agent", "gemini-cli"),
    )

    result = run.run_command(
        [
            "bash",
            str(TASKMD_RT_RUNNER),
            "--workspace",
            str(run.workspace),
            "--task-doc",
            task_doc.relative_to(run.workspace).as_posix(),
            "--r",
            "1",
            "--dry-run",
            "--",
            "continue from the active TODO",
        ],
        label="rt-gemini-latest-dry-run",
    )

    result.assert_success()
    assert "call_1_agent=codex-cli" in result.stdout
    assert "call_2_agent=gemini-cli" in result.stdout


def test_taskmd_rt_bootstrap_does_not_consume_round(test_run_factory) -> None:
    run = test_run_factory("rt-bootstrap")

    result = run.run_command(
        [
            "bash",
            str(TASKMD_RT_RUNNER),
            "--workspace",
            str(run.workspace),
            "--r",
            "1",
            "--dry-run",
            "--",
            "create a task doc for CSV import",
        ],
        label="rt-bootstrap-dry-run",
    )

    result.assert_success()
    assert "continue_after_bootstrap=true" in result.stdout
    assert "bootstrap_agent=codex-cli" in result.stdout
    assert "rounds=1" in result.stdout
    assert "call_1_agent=" not in result.stdout


def test_taskmd_rt_fails_when_cli_does_not_append_worklog(test_run_factory) -> None:
    run = test_run_factory("rt-no-worklog")
    task_doc = run.write_source(
        ".noisy_room/tasks/csv-import.md",
        ROUND_TABLE_TASK_DOC.replace("$agent", "codex-cli"),
    )
    no_op_gemini = _write_fake_agent_script(
        run,
        "fake-gemini-no-op",
        agent="gemini-cli",
        worklog_id=None,
    )

    result = run.run_command(
        [
            "bash",
            str(TASKMD_RT_RUNNER),
            "--workspace",
            str(run.workspace),
            "--task-doc",
            task_doc.relative_to(run.workspace).as_posix(),
            "--gemini-bin",
            no_op_gemini,
            "--r",
            "1",
            "--",
            "continue from the active TODO",
        ],
        label="rt-no-worklog",
        env={"TASK_DOC_UNDER_TEST": str(task_doc)},
    )

    assert result.returncode == 1
    assert "append a new Worklog metadata record" in result.stderr
    assert "Before Worklog records: 1; after Worklog records: 1." in result.stderr


def test_taskmd_rt_accepts_each_cli_appending_worklog(test_run_factory) -> None:
    run = test_run_factory("rt-worklog-advance")
    task_doc = run.write_source(
        ".noisy_room/tasks/csv-import.md",
        ROUND_TABLE_TASK_DOC.replace("$agent", "codex-cli"),
    )
    fake_gemini = _write_fake_agent_script(
        run,
        "fake-gemini-append",
        agent="gemini-cli",
        worklog_id="fake-gemini-work",
    )
    fake_codex = _write_fake_agent_script(
        run,
        "fake-codex-append",
        agent="codex-cli",
        worklog_id="fake-codex-work",
    )

    result = run.run_command(
        [
            "bash",
            str(TASKMD_RT_RUNNER),
            "--workspace",
            str(run.workspace),
            "--task-doc",
            task_doc.relative_to(run.workspace).as_posix(),
            "--gemini-bin",
            fake_gemini,
            "--codex-bin",
            fake_codex,
            "--r",
            "1",
            "--",
            "continue from the active TODO",
        ],
        label="rt-worklog-advance",
        env={"TASK_DOC_UNDER_TEST": str(task_doc)},
    )

    result.assert_success()
    task_doc_text = task_doc.read_text(encoding="utf-8")
    assert "Completed 2 roundtable calls for .noisy_room/tasks/csv-import.md." in result.stdout
    assert '"worklog_id": "fake-gemini-work"' in task_doc_text
    assert '"worklog_id": "fake-codex-work"' in task_doc_text


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


@pytest.mark.skipif(
    os.environ.get("NOISY_RUN_GEMINI_E2E") != "1",
    reason="set NOISY_RUN_GEMINI_E2E=1 to run live Gemini model behavior",
)
def test_gemini_noisy_taskmd_new_creates_task_doc_from_source(test_run_factory) -> None:
    run = test_run_factory("gemini-new-task-doc")
    source = run.write_source("source.md", SOURCE_BRIEF)
    before = run.workspace_file_hashes()
    prompt = (
        "/noisy:taskmd --new create a task doc using source.md as reference. "
        "Treat source.md as reference-only and do not modify it. "
        "Only create the task document; do not implement the described work."
    )

    result = run.gemini_exec(
        prompt,
        label="gemini-new-task-doc",
    )

    result.assert_success()
    task_doc = validate_single_new_task_doc(run.workspace, source_name="source.md")
    assert_new_task_doc_side_effects(run, before=before, task_doc=task_doc)
    verifier_result = run.verify_new_task_doc_semantics(source=source, task_doc=task_doc)

    assert verifier_result["passed"], (
        "Codex verifier rejected the Gemini-generated task doc:\n"
        f"Summary: {verifier_result['summary']}\n"
        f"Issues: {verifier_result['issues']}"
    )
