from __future__ import annotations

import pytest

from tests.scenario_data import BAD_TASK_DOC, SOURCE_BRIEF


pytestmark = pytest.mark.live_codex


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
