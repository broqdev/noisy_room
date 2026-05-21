from __future__ import annotations

import os
import shutil

import pytest

from tests.harness import CodexExecutionProfile, PERMISSIVE_PROFILE, metadata_records


pytestmark = pytest.mark.live_codex


ROUND_TABLE_TASK_DOC = """# Roundtable Fake Delegates

## Goal

Exercise taskmd-rt roundtable orchestration with deterministic fake delegated CLIs.

## Knowledge

- This workspace is a test environment.
- Only `.noisy_room/tasks/roundtable-fake-delegates.md` should change.

## Worklog

### 2026-05-20 00:00:00 UTC - Seeded task doc

```jsonl
{ "agent": "codex-cli", "session_id": "seed", "worklog_id": "seed-work", "trigger": "roadmap" }
```

Seeded the task doc so the next roundtable turn should go to Gemini.

## Archived

## Roadmap

### R001 - Continue roundtable

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: The seeded doc exists only to verify roundtable handoff behavior.

Task: Continue the taskmd-rt fake-delegate handoff.
"""


def _fake_delegate_script(agent: str, worklog_id: str, *, recovered_edit_tool_error: bool = False) -> str:
    recovered_error = ""
    if recovered_edit_tool_error:
        recovered_error = """
echo "Error: edit-tool failed to apply an earlier patch attempt" >&2
echo "Success: recovered and appended the requested Worklog entry" >&2
"""
    return f"""#!/usr/bin/env bash
set -euo pipefail

workspace="$PWD"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -C)
      workspace="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

task_doc="$(find "$workspace/.noisy_room/tasks" -maxdepth 1 -type f -name '*.md' | sort | head -n 1)"
if [ -z "$task_doc" ]; then
  echo "No task doc found" >&2
  exit 1
fi
{recovered_error}

entry_file="$(mktemp)"
tmp_file="$(mktemp)"
cat > "$entry_file" <<'ENTRY'
### 2026-05-20 00:00:00 UTC - Fake {agent} roundtable turn

```jsonl
{{ "agent": "{agent}", "session_id": "fake", "worklog_id": "{worklog_id}", "trigger": "roadmap" }}
```

Fake {agent} appended this Worklog entry for taskmd-rt fake-delegate coverage.

ENTRY

awk 'NR==FNR {{ entry = entry $0 ORS; next }} /^## Archived$/ && inserted == 0 {{ printf "%s", entry; inserted = 1 }} {{ print }} END {{ if (inserted == 0) printf "%s", entry }}' "$entry_file" "$task_doc" > "$tmp_file"
mv "$tmp_file" "$task_doc"
rm -f "$entry_file"
echo "fake {agent} appended {worklog_id}"
"""


def test_noisy_taskmd_rt_orchestrates_one_round_with_fake_delegates(test_run_factory) -> None:
    real_codex = shutil.which("codex")
    if real_codex is None:
        pytest.skip("codex CLI is not installed")

    run = test_run_factory("taskmd-rt-fake-delegates")
    task_doc = run.write_source(".noisy_room/tasks/roundtable-fake-delegates.md", ROUND_TABLE_TASK_DOC)
    fake_bin = run.workspace / "bin"
    fake_bin.mkdir()

    fake_gemini = run.write_source(
        "bin/gemini",
        _fake_delegate_script(
            "gemini-cli",
            "fake-gemini-turn",
            recovered_edit_tool_error=True,
        ),
    )
    fake_codex = run.write_source("bin/codex", _fake_delegate_script("codex-cli", "fake-codex-turn"))
    fake_gemini.chmod(0o755)
    fake_codex.chmod(0o755)

    before = run.workspace_file_hashes()
    prompt = (
        "$noisy:taskmd-rt -r 1 .noisy_room/tasks/roundtable-fake-delegates.md "
        "continue the taskmd-rt fake-delegate handoff. "
        "Use the codex and gemini commands available on PATH for delegated turns. "
        "Do not modify files except the task doc and its default aggregate roundtable log."
    )
    profile = CodexExecutionProfile(
        name="permissive-real-codex-fake-delegates",
        flags=PERMISSIVE_PROFILE.flags,
        timeout_seconds=PERMISSIVE_PROFILE.timeout_seconds,
        binary=real_codex,
    )

    result = run.codex_exec(
        prompt,
        label="codex-taskmd-rt-fake-delegates",
        profile=profile,
        env={
            "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
            "GEMINI_CLI_TRUST_WORKSPACE": "true",
        },
    )

    result.assert_success()
    after = run.workspace_file_hashes()
    task_doc_rel = task_doc.relative_to(run.workspace).as_posix()
    log_rel = ".noisy_room/logs/roundtable-fake-delegates.taskmd-rt.log"
    changed = {path for path in set(before) & set(after) if before[path] != after[path]}
    assert changed == {task_doc_rel}, f"Only the task doc should change; changed {sorted(changed)}"
    assert set(after) - set(before) == {log_rel}, "Roundtable should only add the aggregate log"
    assert set(before) - set(after) == set(), "Roundtable should not remove workspace files"
    log_text = (run.workspace / log_rel).read_text(encoding="utf-8")
    assert "fake gemini-cli appended fake-gemini-turn" in log_text
    assert "fake codex-cli appended fake-codex-turn" in log_text

    worklog = metadata_records(task_doc, "Worklog")
    agents = [record.get("agent") for record in worklog]
    worklog_ids = [record.get("worklog_id") for record in worklog]

    assert agents[-2:] == ["gemini-cli", "codex-cli"]
    assert worklog_ids[-2:] == ["fake-gemini-turn", "fake-codex-turn"]
