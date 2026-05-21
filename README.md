# Noisy Room

Local Codex plugin experiments for Noisy Room workflows.

## Taskmd Skill

The active task document skill lives at:

```text
plugins/noisy/skills/taskmd/SKILL.md
```

It is exposed to Codex as:

```text
noisy:taskmd
```

Use it with prompts such as:

```text
$noisy:taskmd create a task doc use 1.md as reference
```

## Skill Discovery Finding

Codex local skill discovery uses the entry name under `.codex/skills` as the visible skill name. Even though the skill frontmatter is:

```yaml
name: taskmd
```

the trigger `$noisy:taskmd` only appears when the local skill entry is named `noisy:taskmd`.

For this repo, keep:

```text
.codex/skills/noisy:taskmd -> ../../plugins/noisy/skills/taskmd
```

Do not keep a parallel `.codex/skills/taskmd` alias unless you explicitly want to test the non-namespaced trigger. In testing, `noisy:taskmd` appeared correctly, while the plain `taskmd` alias was not useful for the intended workflow.

## Testing In Another Repo

To test the live skill from another workspace, create a symlink named `noisy:taskmd` in that repo's `.codex/skills` directory:

```sh
mkdir -p /path/to/other-repo/.codex/skills
ln -s /Users/xsapphire/pj_ml/pj_noisy_room/noisy_room/plugins/noisy/skills/taskmd \
  '/path/to/other-repo/.codex/skills/noisy:taskmd'
```

For example, `pj_shadow-rogue-self-play-js` is wired as:

```text
/Users/xsapphire/pj_ml/pj_shadow-rogue-self-play-js/.codex/skills/noisy:taskmd
  -> /Users/xsapphire/pj_ml/pj_noisy_room/noisy_room/plugins/noisy/skills/taskmd
```

Start a fresh Codex session after changing `.codex/skills`; existing sessions may keep the old skill list.

You can verify discovery with:

```sh
codex debug prompt-input 'test skill discovery' | rg 'noisy:taskmd'
```
