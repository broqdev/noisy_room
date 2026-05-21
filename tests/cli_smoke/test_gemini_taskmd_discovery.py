from __future__ import annotations

import pytest

from tests.harness import assert_gemini_taskmd_discovered, assert_gemini_taskmd_wired


pytestmark = pytest.mark.cli_smoke


def test_gemini_taskmd_is_discoverable(test_run_factory) -> None:
    run = test_run_factory("gemini-discovery")
    assert_gemini_taskmd_wired(run.workspace)

    result = run.run_command(
        ["gemini", "skills", "list", "--all"],
        label="gemini-skill-discovery",
        env={"GEMINI_CLI_TRUST_WORKSPACE": "true"},
    )

    assert_gemini_taskmd_discovered(result)
