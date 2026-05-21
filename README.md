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

## Gemini CLI Wiring

Gemini CLI uses the `SKILL.md` frontmatter name for Agent Skill discovery, so this
skill appears as:

```text
taskmd
```

The repo also provides a project command for the namespaced workflow:

```text
.gemini/commands/noisy/taskmd.toml -> /noisy:taskmd
.gemini/skills/taskmd -> plugins/noisy/skills/taskmd
```

After changing Gemini wiring in an active session, reload both registries:

```text
/skills reload
/commands reload
```

Then confirm `/skills list` shows `taskmd`. To check from a non-interactive
shell, trust the workspace for that command:

```sh
GEMINI_CLI_TRUST_WORKSPACE=true gemini skills list --all
```

Use the Gemini command with the same taskmd arguments:

```text
/noisy:taskmd --new create a task doc using 1.md as reference
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

One `-r` round means two delegated `noisy:taskmd` CLI turns after a task doc
exists. If no task doc exists, `noisy:taskmd-rt` bootstraps by delegating to
`noisy:taskmd`; that creation step does not consume a round.

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
