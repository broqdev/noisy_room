# Agent Notes

## Noisy Taskmd Skill Wiring

Before changing or testing Noisy Room skill wiring, read `README.md`.

The working local skill trigger is `noisy:taskmd`. Codex exposes the skill name from the entry under `.codex/skills`, so the symlink itself must be named `noisy:taskmd`:

```text
.codex/skills/noisy:taskmd -> ../../plugins/noisy/skills/taskmd
```

When wiring another repo for testing, create that same `noisy:taskmd` symlink in the target repo's `.codex/skills` directory. Do not add a plain `.codex/skills/taskmd` alias unless explicitly testing the non-namespaced trigger.

After changing `.codex/skills`, verify discovery from the target repo:

```sh
codex debug prompt-input 'test skill discovery' | rg 'noisy:taskmd'
```

Existing Codex sessions may keep the old skill list; start a fresh session after wiring changes.
