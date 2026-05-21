from __future__ import annotations

import pytest

from tests.harness import TASKMD_SKILL_DIR, assert_roadmap_entries_have_required_shape


pytestmark = pytest.mark.fast


def test_taskmd_requires_structured_roadmap_items() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "## Roadmap" in skill
    assert "### R001 - <Short action summary>" in skill
    assert '"id": "R001"' in skill
    assert '"created_at": "<YYYY-MM-DD HH:mm:ss UTC>"' in skill
    assert "updated_at" not in skill
    assert '"deps": []' in skill
    assert "Rationale: <Why this is the right next task now.>" in skill
    assert "Task: <Concrete next action and observable completion condition.>" in skill
    assert "future work or ordering context" in skill
    assert "active actionable items" not in skill
    assert "Multiple Roadmap items are normal" in skill
    assert "Treat unchosen Roadmap items as plan context to preserve or update" in skill
    assert "full Roadmap set" in skill
    assert "Rewrite `Knowledge`, `Progress`, and active `Roadmap`" not in skill
    assert "Rename legacy `TODO` to `Roadmap`" in skill
    assert "Do not rewrite archived `type: \"todo\"` bodies" in skill
    assert 'trigger: "roadmap"' in skill
    assert 'trigger: "todo"' in skill


def test_roadmap_validator_accepts_required_shape() -> None:
    lines = """# Example

## Roadmap

### R001 - Continue

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current progress points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    assert_roadmap_entries_have_required_shape(lines)


def test_roadmap_validator_rejects_free_form_body() -> None:
    lines = """# Example

## Roadmap

### R001 - Continue

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "agent": "codex-cli", "session_id": "test" }
```

Inspect the existing entry points.
""".splitlines()

    with pytest.raises(AssertionError, match="Rationale"):
        assert_roadmap_entries_have_required_shape(lines)


def test_roadmap_validator_rejects_heading_metadata_id_mismatch() -> None:
    lines = """# Example

## Roadmap

### R002 - Continue

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current progress points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    with pytest.raises(AssertionError, match="metadata id"):
        assert_roadmap_entries_have_required_shape(lines)
