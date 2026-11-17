from __future__ import annotations

import pytest

from tests.harness import (
    assert_local_skill_symlink_wired,
    assert_noisy_local_skill_discovered,
    assert_noisy_taskmd_discovered,
    assert_noisy_watch_task_discovered,
    assert_skill_symlink_wired,
    assert_watch_task_symlink_wired,
)


pytestmark = pytest.mark.cli_smoke


def test_noisy_taskmd_is_discoverable(test_run_factory) -> None:
    run = test_run_factory("discovery")
    assert_skill_symlink_wired(run.workspace)
    assert_local_skill_symlink_wired(run.workspace)
    assert_watch_task_symlink_wired(run.workspace)

    result = run.run_command(
        ["codex", "debug", "prompt-input", "test skill discovery"],
        label="skill-discovery",
    )

    assert_noisy_taskmd_discovered(result)
    assert_noisy_local_skill_discovered(result)
    assert_noisy_watch_task_discovered(result)
