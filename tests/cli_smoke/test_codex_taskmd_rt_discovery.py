from __future__ import annotations

import pytest

from tests.harness import assert_taskmd_rt_discovered, assert_taskmd_rt_skill_wired


pytestmark = pytest.mark.cli_smoke


def test_noisy_taskmd_rt_is_discoverable(test_run_factory) -> None:
    run = test_run_factory("rt-discovery")
    assert_taskmd_rt_skill_wired(run.workspace)

    result = run.run_command(
        ["codex", "debug", "prompt-input", "test skill discovery"],
        label="rt-skill-discovery",
    )

    assert_taskmd_rt_discovered(result)
