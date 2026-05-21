from __future__ import annotations

import pytest

from tests.harness import TASKMD_SKILL_DIR, assert_roadmap_entries_have_required_shape


pytestmark = pytest.mark.fast


def test_taskmd_requires_structured_roadmap_items() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "## Progress" not in skill
    assert "progress" not in skill.lower()
    assert "## Roadmap" in skill
    assert "### R001 - <Short action summary>" in skill
    assert '"id": "R001"' in skill
    assert '"created_at": "<YYYY-MM-DD HH:mm:ss UTC>"' in skill
    assert "updated_at" not in skill
    assert '"deps": []' in skill
    assert '"parallels": []' in skill
    assert "Rationale: <Why this is the right next task now.>" in skill
    assert "Task: <Concrete next action and observable completion condition.>" in skill
    assert "future work or ordering context" in skill
    assert "active actionable items" not in skill
    assert "Multiple Roadmap items are normal" in skill
    assert "Treat unchosen Roadmap items as plan context to preserve or update" in skill
    assert "full Roadmap set" in skill
    assert "Rename legacy `TODO` to `Roadmap`" in skill
    assert "Do not rewrite archived `type: \"todo\"` bodies" in skill
    assert 'trigger: "roadmap"' in skill
    assert 'trigger: "todo"' in skill
    assert "`parallels` is context for compatible work" in skill
    assert "one subagent per compatible Roadmap item and run them in parallel" in skill


def test_taskmd_documents_action_flag_aliases() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "`-n`/`--new`" in skill
    assert "`-c`/`--continue`" in skill
    assert "`-rv`/`--revisit`" in skill
    assert "`-r`/`--round <N>`" in skill
    assert "`--revisit-n <N>`" in skill
    assert "Treat `-rv` as one exact alias" in skill
    deprecated_threshold_flag = "--revisit-" + "threshold"
    assert deprecated_threshold_flag not in skill


def test_taskmd_rounds_repeat_dispatch_level() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "Dispatch rounds happen at this level" in skill
    assert "manually invoking `$noisy:tmd ...` once" in skill
    assert "reread the task doc" in skill
    assert "rerun intent inference" in skill
    assert "reapply the auto-revisit threshold" in skill
    assert "Do not collapse multiple rounds into one larger `Continue` or `Revisit`" in skill
    assert "Do not invoke `noisy:taskmd-rt` or alternate CLIs" in skill
    assert "ask before creating more than one task doc" in skill


def test_taskmd_revisit_requires_subagent_after_baseline() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "For `Revisit`, the current agent may use related skills as consult-only during the baseline" in skill
    assert "then must delegate the doc-only refresh to a subagent" in skill
    assert "Execute the remaining Revisit work in one subagent run" in skill
    assert "The current agent must not refresh the doc directly" in skill
    assert "if subagent delegation is unavailable, report that blocker instead" in skill
    assert "review the whole task doc" in skill
    assert "Find common issues before editing" in skill
    assert "Goal Drift:" in skill
    assert "Loopholes:" in skill
    assert "Update `Knowledge`" in skill
    assert "Optimize or rewrite `Roadmap`" in skill
    assert "Append `Archived` entries" in skill
    assert 'Append a `Worklog` record with `trigger: "revisit"`' in skill
    assert "reviews Worklog records since the latest" not in skill


def test_roadmap_validator_accepts_required_shape() -> None:
    lines = """# Example

## Roadmap

### R001 - Continue

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current Roadmap points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    assert_roadmap_entries_have_required_shape(lines)


def test_roadmap_validator_rejects_free_form_body() -> None:
    lines = """# Example

## Roadmap

### R001 - Continue

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
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
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current Roadmap points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    with pytest.raises(AssertionError, match="metadata id"):
        assert_roadmap_entries_have_required_shape(lines)
