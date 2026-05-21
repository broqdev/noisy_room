# Agent Notes

## Noisy Taskmd Skill Wiring

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
