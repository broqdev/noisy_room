# Noisy Room

Local Codex plugin experiments for Noisy Room workflows.

## Taskmd Skill

The active task document skill lives at:

```text
plugins/noisy/skills/taskmd/SKILL.md
```

It is exposed to Codex as:

```text
noisy:tmd
```

Use it with prompts such as:

```text
$noisy:tmd -n create a task doc use 1.md as reference
```

## Skill Discovery Finding

Codex local skill discovery uses the namespace from the entry under
`.codex/skills` and the skill name from `SKILL.md` frontmatter. Keep both
aligned:

```yaml
name: tmd
```

For this repo, keep:

```text
.codex/skills/noisy:tmd -> ../../plugins/noisy/skills/taskmd
```

Do not keep a parallel `.codex/skills/taskmd` alias unless you explicitly want to test the non-namespaced trigger. In testing, `noisy:tmd` appeared correctly, while the plain `taskmd` alias was not useful for the intended workflow.

## Testing In Another Repo

To test the live skill from another workspace, create a symlink named `noisy:tmd` in that repo's `.codex/skills` directory:

```sh
mkdir -p /path/to/other-repo/.codex/skills
ln -s /Users/xsapphire/pj_ml/pj_noisy_room/noisy_room/plugins/noisy/skills/taskmd \
  '/path/to/other-repo/.codex/skills/noisy:tmd'
```

For example, `pj_shadow-rogue-self-play-js` is wired as:

```text
/Users/xsapphire/pj_ml/pj_shadow-rogue-self-play-js/.codex/skills/noisy:tmd
  -> /Users/xsapphire/pj_ml/pj_noisy_room/noisy_room/plugins/noisy/skills/taskmd
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
.gemini/skills/tmd -> plugins/noisy/skills/taskmd
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

## Taskmd Roundtable Skill

The roundtable skill lives at:

```text
plugins/noisy/skills/taskmd-rt/SKILL.md
```

It is exposed to Codex as:

```text
noisy:taskmd-rt
```

Use it to alternate an existing task doc between Codex CLI and Gemini CLI:

```text
$noisy:taskmd-rt -r 1 .noisy_room/tasks/example.md continue from the active Roadmap
```

One `-r` round means two delegated `noisy:tmd` CLI turns after a task doc
exists. If no task doc exists, `noisy:taskmd-rt` bootstraps by delegating to
`noisy:tmd`; that creation step does not consume a round.

The skill uses procedural instructions in `SKILL.md`, not a helper script. After
each CLI turn, it verifies that the task doc gained a new Worklog record from
the CLI that just ran. A successful command exit is not enough.

Delegated CLI turns must run from the workspace root that owns the task doc.
Codex uses `-C <workspace-root>` with `--dangerously-bypass-approvals-and-sandbox`
to match Gemini YOLO mode, and Gemini is launched after changing into that
directory with `GEMINI_CLI_TRUST_WORKSPACE=true`, so Gemini checks trust against
the project being worked on instead of the skill/plugin checkout.
When a task doc names an external reference repo that Gemini may inspect,
`taskmd-rt` passes that repo with `--include-directories`; do not include broad
parent directories unless the user explicitly asks.

Each task doc gets one default-on aggregate roundtable log:

```text
.noisy_room/logs/<task-doc-stem>.taskmd-rt.log
```

The log appends every run for that task doc, captures combined delegated CLI
output, and is capped at 100,000 lines by keeping the newest lines after a run
completes.

For this repo, keep:

```text
.codex/skills/noisy:taskmd-rt -> ../../plugins/noisy/skills/taskmd-rt
```
