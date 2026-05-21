# Noisy Room

Local Codex plugin experiments for Noisy Room workflows.

## Taskmd Skill

The active task document skill lives at:

```text
plugins/noisy/skills/tmd/SKILL.md
```

It is exposed to Codex as:

```text
noisy:tmd
```

Use it with prompts such as:

```text
$noisy:tmd -n create a task doc use 1.md as reference
```

To repeat the same Taskmd dispatch several times in the current agent:

```text
$noisy:tmd -c -r 3 .noisy_room/tasks/example.md advance the Roadmap
```

This is local dispatch repetition: `-r` / `--round` repeats `noisy:tmd`
inside the current agent instead of alternating external CLI agents.

## Skill Discovery Finding

Codex local skill discovery uses the namespace from the entry under
`.codex/skills` and the skill name from `SKILL.md` frontmatter. Keep both
aligned:

```yaml
name: tmd
```

For this repo, keep:

```text
.codex/skills/noisy:tmd -> ../../plugins/noisy/skills/tmd
```

Do not keep a parallel `.codex/skills/tmd` alias unless you explicitly want to test the non-namespaced trigger. In testing, `noisy:tmd` appeared correctly, while the plain `tmd` alias was not useful for the intended workflow.

## Testing In Another Repo

To test the live skill from another workspace, create a symlink named `noisy:tmd` in that repo's `.codex/skills` directory:

```sh
mkdir -p /path/to/other-repo/.codex/skills
ln -s /Users/xsapphire/pj_ml/pj_noisy_room/noisy_room/plugins/noisy/skills/tmd \
  '/path/to/other-repo/.codex/skills/noisy:tmd'
```

For example, `pj_shadow-rogue-self-play-js` is wired as:

```text
/Users/xsapphire/pj_ml/pj_shadow-rogue-self-play-js/.codex/skills/noisy:tmd
  -> /Users/xsapphire/pj_ml/pj_noisy_room/noisy_room/plugins/noisy/skills/tmd
```

Start a fresh Codex session after changing `.codex/skills`; existing sessions may keep the old skill list.

You can verify discovery with:

```sh
codex debug prompt-input 'test skill discovery' | rg 'noisy:tmd'
```

## Gemini CLI Wiring

Gemini CLI uses the `SKILL.md` frontmatter name for Agent Skill discovery, so this
skill appears as:

```text
tmd
```

The repo also provides a project command for the namespaced workflow:

```text
.gemini/commands/noisy/tmd.toml -> /noisy:tmd
.gemini/skills/tmd -> plugins/noisy/skills/tmd
```

After changing Gemini wiring in an active session, reload both registries:

```text
/skills reload
/commands reload
```

Then confirm `/skills list` shows `tmd`. To check from a non-interactive
shell, trust the workspace for that command:

```sh
GEMINI_CLI_TRUST_WORKSPACE=true gemini skills list --all
```

Use the Gemini command with the same task-doc arguments:

```text
/noisy:tmd -n create a task doc using 1.md as reference
```
