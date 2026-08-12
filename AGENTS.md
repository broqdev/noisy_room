# Agent Notes

## Noisy Skill Wiring

Before changing or testing Noisy Room skill wiring, read `README.md`.

The working local skill triggers are `noisy:tmd` and `noisy:local-skill`. Codex uses the namespace from each `.codex/skills` entry and the skill name from `SKILL.md` frontmatter, so keep symlink names and frontmatter aligned:

```text
.codex/skills/noisy:tmd -> ../../plugins/noisy/skills/tmd
.codex/skills/noisy:local-skill -> ../../plugins/noisy/skills/local-skill
```

When wiring another repo for testing, create the corresponding namespaced symlink in the target repo's `.codex/skills` directory. Do not add plain `.codex/skills/tmd` or `.codex/skills/local-skill` aliases unless explicitly testing non-namespaced triggers.

After changing `.codex/skills`, verify discovery from the target repo:

```sh
codex debug prompt-input 'test skill discovery' | rg 'noisy:(tmd|local-skill)'
```

Existing Codex sessions may keep the old skill list; start a fresh session after wiring changes.

## Noisy Plugin Marketplace

The repo marketplace is `.agents/plugins/marketplace.json`. Keep these identifiers aligned:

```text
marketplace plugin name: noisy
marketplace source path: ./plugins/noisy
plugin folder: plugins/noisy
plugin manifest name: noisy
```

After marketplace or plugin packaging changes, validate both the marketplace shape test and the plugin manifest before testing installation.

## Browser Usage

When opening, inspecting, navigating, clicking, typing, screenshotting, or testing web pages, use the Codex in-app Browser plugin. Do not launch external Chrome, Safari, Firefox, macOS `open`, or a headed Playwright browser unless the user explicitly asks for an external browser.

For local web targets such as `localhost`, `127.0.0.1`, `::1`, or `file://` URLs, navigate the in-app browser directly. Treat explicit `@browser`, `@browser-use`, or "in-app browser" requests as requiring the Browser plugin.
