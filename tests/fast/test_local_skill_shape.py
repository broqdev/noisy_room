from __future__ import annotations

import pytest

from tests.harness import LOCAL_SKILL_DIR


pytestmark = pytest.mark.fast


def test_local_skill_declares_scriptless_individual_skill_management() -> None:
    skill = (LOCAL_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "name: local-skill" in skill
    assert "Create no Bash, Python, or other executable helper scripts" in skill
    assert "Never install or copy an enclosing plugin" in skill
    assert "`--register <github-repository-url>`" in skill
    assert "`--install <catalog-id>...`" in skill
    assert "`--uninstall <managed-id-or-destination>...`" in skill
    assert "`--update <managed-id-or-destination>...`" in skill
    assert not (LOCAL_SKILL_DIR / "scripts").exists()


def test_local_skill_no_arguments_show_full_install_uninstall_form() -> None:
    skill = (LOCAL_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    metadata = (LOCAL_SKILL_DIR / "agents" / "openai.yaml").read_text(encoding="utf-8")

    assert "No arguments: show the **Registry form**" in skill
    assert "every skill from every source in the selected registry" in skill
    assert "one combined install/uninstall form" in skill
    assert "Start every available skill unchecked; checking it plans an Install" in skill
    assert "Start every consistently managed skill checked; clearing it plans an Uninstall" in skill
    assert "The no-argument form starts with no planned changes" in skill
    assert "Install or uninstall local skills" in skill
    assert "show the install/uninstall form for every skill" in metadata


def test_local_skill_bootstraps_bundled_default_sources() -> None:
    skill = (LOCAL_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    defaults = (LOCAL_SKILL_DIR / "assets" / "sources.list").read_text(encoding="utf-8")

    assert defaults.splitlines() == [
        "https://github.com/EveryInc/compound-engineering-plugin.git",
        "https://github.com/mattpocock/skills.git",
        "https://github.com/DietrichGebert/ponytail.git",
    ]
    assert "## Default bootstrap" in skill
    assert "Bootstrap a missing or empty selected registry" in skill
    assert "Accept one optional `.git` suffix" in skill
    assert "normalize both away before writing the durable registry" in skill
    assert "Do not append defaults to, merge defaults into, or overwrite a non-empty" in skill
    assert "Default bootstrap is the only mutation allowed before the no-argument form" in skill
    assert "it never creates the ledger, `.agents/skills`, or an installed skill" in skill


def test_local_skill_uses_provenance_and_exact_confirmed_plans() -> None:
    skill = (LOCAL_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert ".noisy_room/local-skill/state.json" in skill
    assert '"catalog_id": "owner/repository#path/to/skill"' in skill
    assert '"tree_oid": "git-tree-oid"' in skill
    assert '"installed_fingerprint": "sha256"' in skill
    assert "ledger as the only proof that this manager owns a destination" in skill
    assert "Never overwrite, adopt, update, or uninstall an unmanaged destination" in skill
    assert "NOISY_LOCAL_SKILL_APPLY_V1" in skill
    assert '"catalog_fingerprint": "sha256"' in skill
    assert '"registry_scope": "global"' in skill
    assert '"registry_path": "/absolute/codex-home/state/plugins/noisy/local-skill/sources.list"' in skill
    assert '"state_fingerprint": "sha256"' in skill
    assert "## Fingerprints" in skill
    assert "Treat a missing or empty registry as empty bytes" in skill
    assert "`source_fingerprint`" in skill
    assert "recomputed plan exactly matches the confirmed plan" in skill


def test_local_skill_registry_follows_manager_install_scope() -> None:
    skill = (LOCAL_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "## Registry scope resolution" in skill
    assert "active `noisy:local-skill` discovery entry" in skill
    assert "The lexical discovery entry owns the scope" in skill
    assert "fall back to matching resolved `SKILL.md` file identity" in skill
    assert "globally installed plugins according to the active Codex plugin metadata" in skill
    assert "<codex-home>/state/plugins/noisy/local-skill" in skill
    assert "<current-project>/.noisy_room/local-skill" in skill
    assert "same `<codex-home>/state/plugins/noisy/local-skill/sources.list` in every workspace" in skill
    assert "Never guess, merge registries, or fall back to another scope" in skill
    assert "If the selected registry root is not writable" in skill
    assert "Never fall back to the other scope" in skill
    assert "require the same scope and registry path" in skill


def test_local_skill_keeps_registry_and_target_project_state_separate() -> None:
    skill = (LOCAL_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "Source registry: `<registry-root>/sources.list`" in skill
    assert "Registration lock: `<registry-root>/register.lock/`" in skill
    assert "Project ledger: `<current-project>/.noisy_room/local-skill/state.json`" in skill
    assert "Apply lock: `<current-project>/.noisy_room/local-skill/apply.lock/`" in skill
    assert '`registry_scope` to `"none"`' in skill
    assert '`registry_path` to `null`' in skill
    assert "scope and computed canonical registry path to equal the payload" in skill
    assert "This full-registry domain is the only networked catalog domain" in skill
    assert '"from_catalog_id": "owner/old#path"' in skill
    assert "each affected destination to appear exactly once across all four arrays" in skill
    assert "registry lock as an exclusive read-stability lock" in skill
    assert "require the selected registry root and registry file to remain present and valid" in skill
    assert "An uninstall-only plan acquires no registry lock" in skill


def test_local_skill_stages_updates_and_preserves_recovery_data() -> None:
    skill = (LOCAL_SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "Stage every install, content-changing update, and replacement" in skill
    assert "Never permanently delete an existing skill" in skill
    assert ".noisy_room/local-skill/trash/<UTC-timestamp>-<unique-suffix>/" in skill
    assert "restore every old destination" in skill
    assert "restore `state.previous.json` only when a live ledger existed" in skill
    assert "Uninstall requires no network" in skill
    assert "For an uninstall-only plan" in skill
    assert "do not read or validate `sources.list`" in skill
    assert "requires an enclosing plugin's commands, hooks, agents, MCP server" in skill
