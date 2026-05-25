# Noisy Room

Coding-agent skills for long-running tasks.

## TaskMarkDown Skill

`noisy:tmd` keeps task context, progress, and next actions in one markdown task doc. It works well with loop-style prompts or the Codex `/goal` command when an agent needs to drive a task for hours.

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
