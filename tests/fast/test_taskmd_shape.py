from __future__ import annotations

import pytest

from tests.harness import (
    TASKMD_SKILL_DIR,
    assert_archived_entries_have_required_shape,
    assert_roadmap_entries_have_required_shape,
)


pytestmark = pytest.mark.fast


def test_taskmd_requires_structured_roadmap_items() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "## Progress" not in skill
    assert "progress" not in skill.lower()
    assert "## Archived" in skill
    assert "`Archived` stores only completed or deprecated Roadmap Items" in skill
    assert "never Knowledge history or general notes" in skill
    assert 'Archived roadmap metadata needs `type: "roadmap"`' in skill
    assert "omit active-item `created_at`" in skill
    assert "## Roadmap" in skill
    assert "### R9A3F0C-001 - <Short action summary>" in skill
    assert '"id": "R9A3F0C-001"' in skill
    assert '"created_at": "<YYYY-MM-DD HH:mm:ss UTC>"' in skill
    assert "updated_at" not in skill
    assert '"deps": []' in skill
    assert '"parallels": []' in skill
    assert "<Roadmap note: General guidance for how to work the Roadmap Items below." in skill
    assert "Use `(no more tasks)` only when the Goal is achieved" in skill
    assert "not an item heading or metadata" in skill
    assert "preserve or improve the note during `Continue` and `Revisit`" in skill
    assert "Refresh `Knowledge`, the Roadmap note, and the full Roadmap set" in skill
    assert "Rationale: <Why this is the right next task now.>" in skill
    assert "Task: <Concrete next action and observable completion condition.>" in skill
    assert "still represent useful future work or ordering context" in skill
    assert "active actionable items" not in skill
    assert "including unselected items" in skill
    assert "New Roadmap IDs use `R<DOCKEY>-<NNN>`" in skill
    assert "For docs without this ID shape, use the key only for new IDs" in skill
    assert "choose the next `NNN` after the largest matching ID" in skill
    assert "active Roadmap or Archived metadata" in skill
    assert "project-wide collision scan" not in skill
    assert "later conflicts are not disasters" not in skill
    assert "do not migrate IDs unless asked" not in skill
    assert "Treat unchosen items as context to preserve or update" in skill
    assert "full Roadmap set" in skill
    assert "Normalize only useful contract gaps" in skill
    assert "top-level order, metadata, Roadmap note" in skill
    assert "Move completed/deprecated items to `Archived`" in skill
    assert 'trigger: "roadmap"' in skill
    assert 'trigger: "todo"' not in skill
    assert "legacy `TODO`" not in skill
    assert "`parallels` as compatible same-wave work" in skill
    assert "scanning every active Roadmap item for a useful parallel execution wave" in skill
    assert "Invoking `Action: Continue` selects a compatible execution wave" in skill
    assert "Prefer first-class subagent delegation only when the current runtime exposes a reliable subagent primitive" in skill
    assert "execute the selected wave locally while keeping item scopes explicit" in skill
    assert "do not pretend delegation occurred" in skill
    assert "record the actual execution mode in `Worklog`" in skill
    assert "Worklog must state whether selected Roadmap Items were completed by first-class subagents, local execution, or a fallback path" in skill
    assert "launch one subagent per item in the same wave" not in skill
    assert "authorizes subagents for compatible selected Roadmap items" not in skill
    assert "name each selected Roadmap Item that completed" in skill
    assert "Move completed/deprecated Roadmap Items from active `Roadmap` into `Archived`" in skill
    assert "Archived must receive each completed/deprecated selected Roadmap Item" in skill
    assert "remove every completed selected Roadmap Item" in skill
    assert "keep every still-relevant unselected item" in skill


def test_taskmd_documents_action_flag_aliases() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "`-n`/`--new`" in skill
    assert "`-c`/`--continue`" in skill
    assert "`-rv`/`--revisit`" in skill
    assert "`--revisit-n <N>`" in skill
    assert "Treat `-rv` as one exact alias" in skill
    assert "--round" not in skill
    assert "`-r <N>`" not in skill
    deprecated_threshold_flag = "--revisit-" + "threshold"
    assert deprecated_threshold_flag not in skill


def test_taskmd_revisit_prefers_subagent_with_local_fallback() -> None:
    skill = (TASKMD_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "Use related skills when they help with the prompt" in skill
    assert "Prefer the most specific matching skill" in skill
    assert "`New` and `Revisit` stay doc-only" in skill
    assert "`Continue` may use skills for task work" in skill
    assert "A due Revisit is mandatory doc-only work" in skill
    assert "must not skip Revisit" in skill
    assert "Prefer one subagent run" in skill
    assert "complete the same Revisit locally instead of blocking" in skill
    assert "If a subagent ran, review its result" in skill
    assert "then must delegate the doc-only refresh to a subagent" not in skill
    assert "The current agent must not refresh the doc directly" not in skill
    assert "if subagent delegation is unavailable, report that blocker instead" not in skill
    assert "Review and audit whole doc" in skill
    assert "optimize `Knowledge`, optimize `Roadmap`" in skill
    assert "summarize audit, research, doc-only changes" in skill
    assert "Check common issues before editing" in skill
    assert "Goal Drift:" in skill
    assert "Goal Drift: Roadmap items" in skill
    assert "Loopholes:" in skill
    assert "looped (or repeated) path in Worklogs or Roadmap items" in skill
    assert "Favor web research" in skill
    assert "current external facts could affect `Goal`, `Knowledge`, or `Roadmap`" in skill
    assert 'apply `Existing Task Doc Update Order` with `trigger: "revisit"` and no task work' in skill
    assert "Worklog should summarize the audit" not in skill
    assert "meaningful removals" in skill
    assert "work or Roadmap items" not in skill
    assert "repeated workarounds, shortcuts" not in skill
    assert "`Knowledge`: keep current durable facts" not in skill
    assert "`Roadmap`: keep the smallest useful next actions toward `Goal`" not in skill
    assert "reviews Worklog records since the latest" not in skill


def test_roadmap_validator_accepts_required_shape() -> None:
    lines = """# Example

## Roadmap

Work the Roadmap Items below in order unless dependency and parallel metadata point to a better execution wave.

### R9A3F0C-001 - Continue

```jsonl
{ "id": "R9A3F0C-001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current Roadmap points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    assert_roadmap_entries_have_required_shape(lines)


def test_archived_validator_accepts_completed_roadmap_record() -> None:
    lines = """# Example

## Archived

### 2026-05-20 00:00:00 UTC - Completed R9A3F0C-001

```jsonl
{ "type": "roadmap", "id": "R9A3F0C-001", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

R9A3F0C-001 completed successfully and left active Roadmap.
""".splitlines()

    assert_archived_entries_have_required_shape(lines)


def test_archived_validator_rejects_non_roadmap_record() -> None:
    lines = """# Example

## Archived

### 2026-05-20 00:00:00 UTC - Stale knowledge

```jsonl
{ "type": "knowledge", "agent": "codex-cli", "session_id": "test" }
```

Old fact.
""".splitlines()

    with pytest.raises(AssertionError, match="only store roadmap"):
        assert_archived_entries_have_required_shape(lines)


def test_archived_validator_rejects_active_created_at() -> None:
    lines = """# Example

## Archived

### 2026-05-20 00:00:00 UTC - Completed R001

```jsonl
{ "type": "roadmap", "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

R001 completed successfully and left active Roadmap.
""".splitlines()

    with pytest.raises(AssertionError, match="created_at"):
        assert_archived_entries_have_required_shape(lines)


def test_roadmap_validator_accepts_no_more_tasks_note_when_empty() -> None:
    lines = """# Example

## Roadmap

(no more tasks)
""".splitlines()

    assert_roadmap_entries_have_required_shape(lines, allow_empty=True)


def test_roadmap_validator_rejects_empty_roadmap_without_complete_note() -> None:
    lines = """# Example

## Roadmap

All set.
""".splitlines()

    with pytest.raises(AssertionError, match="no more tasks"):
        assert_roadmap_entries_have_required_shape(lines, allow_empty=True)


def test_roadmap_validator_rejects_items_without_note() -> None:
    lines = """# Example

## Roadmap

### R001 - Continue

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current Roadmap points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    with pytest.raises(AssertionError, match="start with a note"):
        assert_roadmap_entries_have_required_shape(lines)


def test_roadmap_validator_rejects_complete_note_with_active_items() -> None:
    lines = """# Example

## Roadmap

(no more tasks)

### R001 - Continue

```jsonl
{ "id": "R001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current Roadmap points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    with pytest.raises(AssertionError, match="only when no active Roadmap items remain"):
        assert_roadmap_entries_have_required_shape(lines)


def test_roadmap_validator_rejects_free_form_body() -> None:
    lines = """# Example

## Roadmap

Work the Roadmap Items below in order unless dependency and parallel metadata point to a better execution wave.

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

Work the Roadmap Items below in order unless dependency and parallel metadata point to a better execution wave.

### R9A3F0C-002 - Continue

```jsonl
{ "id": "R9A3F0C-001", "created_at": "2026-05-20 00:00:00 UTC", "deps": [], "parallels": [], "agent": "codex-cli", "session_id": "test" }
```

Rationale: The current Roadmap points to one narrow follow-up.

Task: Inspect the existing entry points and report the next implementation slice.
""".splitlines()

    with pytest.raises(AssertionError, match="metadata id"):
        assert_roadmap_entries_have_required_shape(lines)
