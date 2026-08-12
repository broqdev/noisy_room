from __future__ import annotations

import json

import pytest

from tests.harness import REPO_ROOT


pytestmark = pytest.mark.fast


def test_repo_marketplace_exposes_noisy_plugin() -> None:
    marketplace_path = REPO_ROOT / ".agents" / "plugins" / "marketplace.json"
    marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))

    assert marketplace["name"] == "noisy-room"
    assert marketplace["interface"] == {"displayName": "Noisy Room"}
    assert marketplace["plugins"] == [
        {
            "name": "noisy",
            "source": {
                "source": "local",
                "path": "./plugins/noisy",
            },
            "policy": {
                "installation": "AVAILABLE",
                "authentication": "ON_INSTALL",
            },
            "category": "Coding",
        }
    ]

    plugin_path = REPO_ROOT / marketplace["plugins"][0]["source"]["path"]
    assert plugin_path.resolve() == (REPO_ROOT / "plugins" / "noisy").resolve()
    assert (plugin_path / ".codex-plugin" / "plugin.json").is_file()
