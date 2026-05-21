from __future__ import annotations

import os
import shlex
import shutil

import pytest

from tests.harness import CodexExecutionProfile, PERMISSIVE_PROFILE, metadata_records


pytestmark = pytest.mark.live_roundtable


REAL_ROUND_TABLE_TASK_DOC = """# Roundtable Real E2E

## Goal

Exercise the real taskmd-rt roundtable flow with one shared task doc.

## Knowledge

- This workspace is a test environment.
- Only `.noisy_room/tasks/roundtable-real-e2e.md` should change.
- Delegated Codex and Gemini turns should each append one Worklog entry.

## Progress

The task doc is ready for a one-round real handoff.

## Worklog

### 2026-05-20 00:00:00 UTC - Seeded task doc

```jsonl
{ "agent": "codex-cli", "session_id": "seed", "worklog_id": "seed-work", "trigger": "roadmap" }
```

Seeded the task doc so the next roundtable turn should go to Gemini.

## Archived

## Roadmap

### R001 - Continue real roundtable

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "agent": "codex-cli", "session_id": "seed" }
```

Rationale: The seeded doc exists only to verify the real roundtable handoff behavior.

Task: Append real Gemini and Codex roundtable Worklog entries without changing other files.
"""


def _real_cli_wrapper_script(cli_name: str, real_binary: str, log_path: os.PathLike[str]) -> str:
    return f"""#!/usr/bin/env bash
set -euo pipefail

printf '%s\\t' {shlex.quote(cli_name)} >> {shlex.quote(os.fspath(log_path))}
printf '%q ' "$@" >> {shlex.quote(os.fspath(log_path))}
printf '\\n' >> {shlex.quote(os.fspath(log_path))}
exec {shlex.quote(real_binary)} "$@"
"""


@pytest.mark.skipif(
    os.environ.get("NOISY_RUN_TASKMD_RT_E2E") != "1",
    reason="set NOISY_RUN_TASKMD_RT_E2E=1 to run real taskmd-rt Codex/Gemini E2E",
)
def test_noisy_taskmd_rt_runs_one_round_with_real_delegated_clis(test_run_factory) -> None:
    real_codex = shutil.which("codex")
    real_gemini = shutil.which("gemini")
    if real_codex is None:
        pytest.skip("codex CLI is not installed")
    if real_gemini is None:
        pytest.skip("gemini CLI is not installed")

    run = test_run_factory("taskmd-rt-real-e2e")
    task_doc = run.write_source(".noisy_room/tasks/roundtable-real-e2e.md", REAL_ROUND_TABLE_TASK_DOC)
    spy_bin = run.workspace / "bin"
    spy_bin.mkdir()
    invocation_log = run.artifacts / "delegated-cli-invocations.log"
    spy_codex = run.write_source("bin/codex", _real_cli_wrapper_script("codex", real_codex, invocation_log))
    spy_gemini = run.write_source("bin/gemini", _real_cli_wrapper_script("gemini", real_gemini, invocation_log))
    spy_codex.chmod(0o755)
    spy_gemini.chmod(0o755)

    before = run.workspace_file_hashes()
    prompt = (
        "$noisy:taskmd-rt -r 1 .noisy_room/tasks/roundtable-real-e2e.md "
        "continue the real taskmd-rt E2E handoff. "
        "Use the real codex and gemini commands available on PATH for delegated turns. "
        "The current outer Codex process is only the orchestrator; do not perform a "
        "delegated Codex turn yourself. "
        "When invoking delegated Codex, include --skip-git-repo-check, --ephemeral, "
        "and --dangerously-bypass-approvals-and-sandbox. "
        "When invoking delegated Gemini, use GEMINI_CLI_TRUST_WORKSPACE=true and "
        "--skip-trust --approval-mode yolo. "
        "Only update the task doc and its default aggregate roundtable log. "
        "Do not create, remove, or edit other workspace files."
    )
    profile = CodexExecutionProfile(
        name="permissive-real-roundtable-e2e",
        flags=PERMISSIVE_PROFILE.flags,
        timeout_seconds=1200,
        binary=real_codex,
    )

    result = run.codex_exec(
        prompt,
        label="codex-taskmd-rt-real-e2e",
        profile=profile,
        env={
            "GEMINI_CLI_TRUST_WORKSPACE": "true",
            "PATH": f"{spy_bin}{os.pathsep}{os.environ['PATH']}",
        },
    )

    result.assert_success()
    after = run.workspace_file_hashes()
    task_doc_rel = task_doc.relative_to(run.workspace).as_posix()
    log_rel = ".noisy_room/logs/roundtable-real-e2e.taskmd-rt.log"
    changed = {path for path in set(before) & set(after) if before[path] != after[path]}
    assert changed == {task_doc_rel}, f"Only the task doc should change; changed {sorted(changed)}"
    assert set(after) - set(before) == {log_rel}, "Roundtable should only add the aggregate log"
    assert set(before) - set(after) == set(), "Roundtable should not remove workspace files"
    log_text = (run.workspace / log_rel).read_text(encoding="utf-8")
    assert "gemini" in log_text
    assert "codex" in log_text

    worklog = metadata_records(task_doc, "Worklog")
    assert len(worklog) >= 3, f"Expected seed plus two roundtable Worklog records, got {worklog}"
    agents = [record.get("agent") for record in worklog]
    worklog_ids = [str(record.get("worklog_id", "")) for record in worklog]

    assert agents[-2:] == ["gemini-cli", "codex-cli"]
    assert not any(worklog_id.startswith("fake-") for worklog_id in worklog_ids[-2:])

    assert invocation_log.exists(), "Roundtable should invoke delegated CLI processes"
    invocations = invocation_log.read_text(encoding="utf-8").splitlines()
    invoked_cli_names = [line.split("\t", 1)[0] for line in invocations]
    assert invoked_cli_names[:2] == ["gemini", "codex"], (
        "One round should invoke real Gemini then real Codex through PATH; "
        f"saw {invoked_cli_names}"
    )
