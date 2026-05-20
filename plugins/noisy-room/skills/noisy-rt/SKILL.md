---
name: noisy-rt
description: Project-local prefixed RT argument dispatcher for noisy-room. Use when explicitly invoked as $noisy-rt with arguments such as --t1 or --t2, when the user mentions the noisy:rt workflow prefix, or when adding noisy-room RT-specific scripts, references, and assets.
---

# Noisy RT

## Purpose

Use this skill as the project-local entry point for prefixed, argument-driven RT workflows.

Codex skill names must use lowercase letters, digits, and hyphens, so the discoverable skill name is `$noisy-rt`. Treat user text like `noisy:rt --t1` as an alias for `$noisy-rt --t1` after this skill has been invoked.

## Arguments

- `--t1`: execute the T1 section.
- `--t2`: execute the T2 section.

If no supported argument is present, tell the user the supported arguments and wait for a follow-up. If an unsupported argument is present, stop and report it instead of guessing.

## Dispatch Workflow

1. Parse supported arguments from the user request in the order they appear.
2. Create a task list with one item per selected section before running commands.
3. Execute selected sections one at a time in argument order.
4. Mark each task complete after its command succeeds.
5. Stop on the first non-zero exit code and report the failing section.

## T1

Run:

```bash
echo t1
```

## T2

Run:

```bash
echo t2
```

## Discovery

This skill is intended to be installed through the project-local symlink at `.codex/skills/noisy-rt`, pointing to `plugins/noisy-room/skills/noisy-rt`.
