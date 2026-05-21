from __future__ import annotations

import pytest

from tests.harness import TASKMD_SKILL_DIR, assert_todo_entries_have_rationale_and_task


pytestmark = pytest.mark.fast


def test_taskmd_requires_structured_todo_entries() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "Rationale: <Why this is the right next task now.>" in skill
    assert "Task: <Concrete next action and observable completion condition.>" in skill
    assert "Do not put these fields in metadata" in skill
    assert "rewrite it into `Rationale:` and `Task:`" in skill
    assert "Do not rewrite archived `type: \"todo\"` bodies" in skill


def test_todo_validator_accepts_rationale_task_body() -> None:
    lines = """# Example

## TODO

### 2026-05-20 00:00:00 UTC - Continue

```jsonl
{ "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current progress points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    assert_todo_entries_have_rationale_and_task(lines)


def test_todo_validator_rejects_free_form_body() -> None:
    lines = """# Example

## TODO

### 2026-05-20 00:00:00 UTC - Continue

```jsonl
{ "agent": "codex-cli", "session_id": "test" }
```

Inspect the existing entry points.
""".splitlines()

    with pytest.raises(AssertionError, match="Rationale"):
        assert_todo_entries_have_rationale_and_task(lines)
