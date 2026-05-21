from __future__ import annotations

import tomllib

import pytest

from tests.harness import assert_gemini_taskmd_wired


pytestmark = pytest.mark.fast


def test_gemini_taskmd_wiring_uses_command_wrapper(test_run_factory) -> None:
    run = test_run_factory("gemini-wiring")
    assert_gemini_taskmd_wired(run.workspace)

    command_path = run.workspace / ".gemini" / "commands" / "noisy" / "taskmd.toml"
    command = tomllib.loads(command_path.read_text(encoding="utf-8"))

    description = command.get("description")
    prompt = command.get("prompt")
    assert isinstance(description, str) and description.strip(), "Gemini command needs a description"
    assert isinstance(prompt, str), "Gemini command needs a prompt"
    assert "taskmd" in prompt, "Command should name the Gemini Agent Skill"
    assert "/noisy:taskmd" in prompt, "Command should preserve the namespaced user invocation"
    assert "{{args}}" in prompt, "Command should pass user arguments through"
    assert "!{" not in prompt, "Command should not use shell injection"
