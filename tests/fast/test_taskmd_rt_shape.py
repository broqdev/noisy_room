from __future__ import annotations

import pytest

from tests.harness import TASKMD_RT_SKILL_DIR


pytestmark = pytest.mark.fast


def test_taskmd_rt_uses_direct_skill_logic_without_helper_script() -> None:
    skill = (TASKMD_RT_SKILL_DIR / "SKILL.md").read_text()
    runner = TASKMD_RT_SKILL_DIR / "scripts" / "run_roundtable.sh"

    assert not runner.exists()
    assert "Do not use a helper script" in skill
    assert 'codex exec --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox -C "$workspace_root"' in skill
    assert "Codex CLI equivalent of Gemini YOLO mode" in skill
    assert "Do not let it inherit a read-only sandbox" in skill
    assert 'cd "$workspace_root" && GEMINI_CLI_TRUST_WORKSPACE=true gemini' in skill
    assert '"${gemini_include_args[@]}"' in skill
    assert "--include-directories" in skill
    assert "Do not include broad directories" in skill
    assert "--skip-trust --approval-mode yolo" in skill
    assert "trusted directory" in skill
    assert ".noisy_room/logs/<task-doc-stem>.taskmd-rt.log" in skill
    assert "Create this log by default" in skill
    assert "Do not create separate per-turn log files" in skill
    assert 'tee -a "$log_file"' in skill
    assert "PIPESTATUS[0]" in skill
    assert "100,000 lines" in skill
    assert "Markdown file link" in skill
    assert "absolute filesystem target" in skill
    assert "Before the first delegated CLI call" in skill
    assert "Report the aggregate log path again if useful" in skill
    assert "Do not write the aggregate log link into the task doc" in skill
    assert "Gemini may print an edit-tool error before a later success summary" in skill
    assert "If Gemini exits `0` and the Worklog advanced, treat the turn as successful" in skill
    assert "Do not trust success prose by itself" in skill
    assert "Optional `-r N`" in skill
    assert "Parse `-r N`" in skill
    assert "--r" not in skill
    assert "Set total delegated turns to `2 * N`" in skill
    assert "Always re-read the latest Worklog before each turn" in skill
    assert "opposite CLI from the CLI attempted in the previous delegated turn" in skill
    assert "Do not retry the same CLI just because a failed turn left the task doc's latest Worklog unchanged" in skill
    assert "A failed delegated turn is a turn outcome, not a roundtable stop condition" in skill
    assert "how many delegated turns were attempted, how many succeeded verification, and how many failed" in skill
    assert "generated wrapper scripts" in skill
    assert "python" not in skill.lower()
