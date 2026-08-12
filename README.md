# Noisy Room

Noisy Room provides two Codex workflows:

- `noisy:tmd` keeps durable task state for long-running work.
- `noisy:local-skill` manages individual project-local skills from GitHub repositories.

## Task Markdown: `noisy:tmd`

`noisy:tmd` keeps task context, progress, and next actions in one markdown document under `<current-project>/.noisy_room/tasks/*.md`. It supports work across many agent turns and composes with other skills in Codex `/goal` loops.

Skill source: [`plugins/noisy/skills/tmd/SKILL.md`](plugins/noisy/skills/tmd/SKILL.md)

### Usage

Create a task document:

```text
$noisy:tmd --new create a frontend for xyz, do smoke test
```

Continue an existing task:

```text
$noisy:tmd --continue
```

The skill can infer the action when called without flags:

```text
$noisy:tmd
```

### Long-running goal loop

This `/goal` prompt uses Matt Pocock's [grill-with-docs](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md) to choose the next task, then returns to `noisy:tmd` to execute and record it:

```text
/goal - use $grill-with-docs to find out what's next task
- create or update a task doc. follow all your recommends (no need to ask me)
- keep triggering $noisy:tmd to execute the task doc
- loop this process (go back to use $grill-with-docs)
```

### Example

- [Migrate Shattered Pixel Dungeon to Web](tests-heavy/dungeon/prompt.md)

## Local Skill Manager: `noisy:local-skill`

`noisy:local-skill` installs, updates, replaces, and recoverably uninstalls individual skills under `<current-project>/.agents/skills`. It installs only the selected skill directory, never its enclosing plugin.

`<current-project>` is the physical Git repository root, or the physical current working directory outside Git.

Skill source: [`plugins/noisy/skills/local-skill/SKILL.md`](plugins/noisy/skills/local-skill/SKILL.md)

### Install as a Codex plugin

Register this repository's marketplace and install the `noisy` plugin:

```sh
codex plugin marketplace add broqdev/noisy_room --ref dev/main
codex plugin add noisy@noisy-room
```

Restart the Codex app, then start a new task so Codex discovers the bundled `noisy:tmd` and `noisy:local-skill` skills. To install through the app instead of the second command, open **Plugins**, select **Noisy Room**, open **Noisy**, and select the plus button.

### Registry scope

The source registry follows how `noisy:local-skill` was discovered:

- A globally discovered manager shares registrations across workspaces using the same `CODEX_HOME`.
- A project-discovered manager keeps registrations in the current project.

Global and project registries are never merged or used as fallbacks.

### Storage

| Data | Path |
| --- | --- |
| Project-scoped source registry | `<current-project>/.noisy_room/local-skill/sources.list` |
| Global source registry | `$CODEX_HOME/state/plugins/noisy/local-skill/sources.list` |
| Ledger, locks, transactions, and recovery data | `<current-project>/.noisy_room/local-skill/` |
| Installed skill directories | `<current-project>/.agents/skills/` |

Project-owned state remains under `.noisy_room/local-skill`, even when the source registry is global. Only installed skill directories live under `.agents/skills`.

### Usage

Register a source and open the picker:

```text
$noisy:local-skill --register https://github.com/owner/repository
```

Browse registered skills or preview a direct action:

```text
$noisy:local-skill
$noisy:local-skill --install owner/repository#path/to/skill
$noisy:local-skill --update skill-name
$noisy:local-skill --uninstall skill-name
```

### Apply and recovery

The picker prepares a plan without changing the project. A separate confirmed follow-up applies the exact fingerprinted plan. Replaced and removed skill directories remain recoverable under `.noisy_room/local-skill/trash/`.
