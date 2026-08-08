# Noisy Room

Coding-agent workflows for long-running tasks and project-local skill management.

## TaskMarkDown Skill

`noisy:tmd` keeps task context, progress, and next actions in one markdown task doc under the project's `.noisy_room/tasks/*.md`. It works well with loop-style prompts or the Codex `/goal` command when an agent needs to drive a task for hours.

## Usage

Codex skill file:

```text
plugins/noisy/skills/tmd/SKILL.md
```

Create a task doc:

```text
$noisy:tmd --new create a frontend for xyz, do smoke test
```

Continue a task:

```text
$noisy:tmd --continue
```

The skill has its own dispatch logic, so it can run without arguments and can be combined with other skills. This `/goal` prompt creates or updates a task doc, executes it, then loops back through Matt Pocock's [grill-with-docs](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md):

```text
/goal - use $grill-with-docs to find out what's next task
- create or update a task doc. follow all your recommends (no need to ask me)
- keep triggering $noisy:tmd to execute the task doc
- loop this process (go back to use $grill-with-docs)
```

## Examples

- [Migrate Shattered Pixel Dungeon to Web](tests-heavy/dungeon/prompt.md)

## Local Skill Manager

`noisy:local-skill` installs, updates, replaces, and recoverably uninstalls individual skills under the current project's `.agents/skills`. It never installs an enclosing plugin. The current project is the physical Git repository root, falling back to the physical current working directory outside Git.

Repository registrations follow how the manager itself was discovered:

- A globally discovered manager stores sources in `$CODEX_HOME/state/plugins/noisy/local-skill/sources.list`, so the same registrations are available across workspaces using that Codex home.
- A project-discovered manager stores sources in the current project's `.noisy_room/local-skill/sources.list`, so registrations remain local to that project.

The two registries are never merged or used as fallbacks.

### Storage

| Data | Path |
| --- | --- |
| Task markdown documents | `<current-project>/.noisy_room/tasks/*.md` |
| Project-scoped source registry | `<current-project>/.noisy_room/local-skill/sources.list` |
| Global source registry | `$CODEX_HOME/state/plugins/noisy/local-skill/sources.list` |
| Installed-skill ledger, locks, transactions, and recovery | `<current-project>/.noisy_room/local-skill/` |
| Installed skill directories | `<current-project>/.agents/skills/` |

Project-owned state remains under `.noisy_room/local-skill` even when the source registry is global. Only installed skill directories live under `.agents/skills`.

Codex skill file:

```text
plugins/noisy/skills/local-skill/SKILL.md
```

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

The picker only prepares a plan. A separate confirmed follow-up applies the exact fingerprinted plan and keeps replaced or removed folders under `.noisy_room/local-skill/trash/` for recovery.
