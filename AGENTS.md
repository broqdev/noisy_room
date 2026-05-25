# Agent Notes

## Noisy TaskmMarkdown Skill Wiring

Before changing or testing Noisy Room skill wiring, read `README.md`.

The working local skill trigger is `noisy:tmd`. Codex uses the namespace from the `.codex/skills` entry and the skill name from `SKILL.md` frontmatter, so keep the symlink name and frontmatter aligned:

```text
.codex/skills/noisy:tmd -> ../../plugins/noisy/skills/tmd
```

When wiring another repo for testing, create that same `noisy:tmd` symlink in the target repo's `.codex/skills` directory. Do not add a plain `.codex/skills/tmd` alias unless explicitly testing the non-namespaced trigger.

After changing `.codex/skills`, verify discovery from the target repo:

```sh
codex debug prompt-input 'test skill discovery' | rg 'noisy:tmd'
```

Existing Codex sessions may keep the old skill list; start a fresh session after wiring changes.

## Browser Usage

When opening, inspecting, navigating, clicking, typing, screenshotting, or testing web pages, use the Codex in-app Browser plugin. Do not launch external Chrome, Safari, Firefox, macOS `open`, or a headed Playwright browser unless the user explicitly asks for an external browser.

For local web targets such as `localhost`, `127.0.0.1`, `::1`, or `file://` URLs, navigate the in-app browser directly. Treat explicit `@browser`, `@browser-use`, or "in-app browser" requests as requiring the Browser plugin.