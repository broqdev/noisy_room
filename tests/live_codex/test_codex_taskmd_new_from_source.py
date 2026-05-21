from __future__ import annotations

import pytest

from tests.harness import (
    assert_new_task_doc_side_effects,
    validate_single_new_task_doc,
)
from tests.scenario_data import SOURCE_BRIEF


pytestmark = pytest.mark.live_codex


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
