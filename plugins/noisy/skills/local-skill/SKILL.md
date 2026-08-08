---
name: local-skill
description: Manage individual project-local Codex skills from install-scope-aware GitHub source registries without installing their enclosing plugins. Use for `$noisy:local-skill`; registering a skill repository globally or for one project; browsing available skills; or installing, uninstalling, replacing, and updating skills under a project's `.agents/skills` directory. Supports `--register`, `--install`, `--uninstall`, and `--update`.
---

# Local Skill

Manage desired project-local skills with direct shell commands and an inline Visualize picker. Select the source registry from how this manager skill was discovered: a globally discovered manager shares registrations across Codex workspaces, while a project-discovered manager keeps registrations in the current project. Create no Bash, Python, or other executable helper scripts. Never install or copy an enclosing plugin.

## Route

Choose exactly one route:

- A confirmed `NOISY_LOCAL_SKILL_APPLY_V1` follow-up: run **Apply**.
- `--register <github-repository-url>`: run **Register**, then **Browse**.
- `--install <catalog-id>...`: run **Preview** with those skills selected for installation.
- `--uninstall <managed-id-or-destination>...`: run **Preview** with those managed skills selected for removal.
- `--update <managed-id-or-destination>...`: run **Preview** with those managed skills selected for update.
- No action flag: run **Browse**.

Accept one action flag per invocation and at least one value for an action that requires values. Reject duplicate values, unsupported flags, extra positional arguments, conflicting routes, and an apply marker not followed by exactly one valid JSON payload.

## Registry scope resolution

Resolve registry scope before Register, Browse, Install, Update, Replace, or any networked Apply. Base it on the active `noisy:local-skill` discovery entry, not merely the physical directory containing this file:

1. Record the exact `SKILL.md` source locator shown for this active skill in the current skill catalog, then resolve its file identity and physical target without following any path during later mutation.
2. Enumerate only Codex discovery entries that could have supplied that active file. Project entries are `local-skill` or `noisy:local-skill` entries below `.agents/skills` from the working directory through the repository root, plus this repository's supported project-development entries below `.codex/skills`. Global entries are below the resolved user `.agents/skills`, `$CODEX_HOME/skills`, `/etc/codex/skills`, Codex system-skill roots, and entries contributed by globally installed plugins according to the active Codex plugin metadata. Treat a globally installed plugin entry as global even when its cache or symlink target resolves elsewhere.
3. First match the catalog locator exactly against candidate discovery entries. If no candidate has that exact lexical locator—as occurs when the catalog displays a symlink's physical target—fall back to matching resolved `SKILL.md` file identity. The lexical discovery entry owns the scope even when it is a symlink: a project entry pointing outside the project is still project-scoped, and a global entry pointing into a checkout is still global.
4. If exactly one scope matches, select it. Collapse same-scope aliases that resolve to the same active file. If project and global entries both match the active file, or no recognized discovery entry matches, stop and report the candidate entries; a resolved source locator cannot prove which of two cross-scope aliases Codex selected. Never guess, merge registries, or fall back to another scope.

Resolve `<current-project>` once from the apply payload during Apply; otherwise use the physical Git repository root containing the current working directory, or the physical current working directory when outside Git. Require it to be an absolute real directory and bind that exact value into Preview payloads.

For project scope, set `<registry-root>` to `<current-project>/.noisy_room/local-skill`. For global scope, resolve `<codex-home>` from an absolute `CODEX_HOME` when set, otherwise from the platform user's home directory plus `.codex`, and set `<registry-root>` to `<codex-home>/state/plugins/noisy/local-skill`. Resolve it to an absolute path before issuing commands; never use literal `~`, an unresolved environment variable, the plugin cache, or the manager skill directory as durable storage.

The selected registry is exclusive. A global manager uses the same `<codex-home>/state/plugins/noisy/local-skill/sources.list` in every workspace that shares that Codex home. A project manager uses only `<current-project>/.noisy_room/local-skill/sources.list`. Do not union global and project registrations, and do not copy registrations automatically when scope changes.

## Paths and durable state

Use `<current-project>` as the target project. Keep registry state at the resolved scope and all project mutation state under its Noisy Room directory:

- Source registry: `<registry-root>/sources.list`.
- Registration lock: `<registry-root>/register.lock/`.
- Target skills: `<current-project>/.agents/skills/<destination>`.
- Project ledger: `<current-project>/.noisy_room/local-skill/state.json`.
- Apply lock: `<current-project>/.noisy_room/local-skill/apply.lock/`.
- Transactions and recovery data: `<current-project>/.noisy_room/local-skill/`.

Require every existing managed path component to be a regular, non-symlinked directory or file of its expected type. Refuse symlinked components, special files, and destination names outside `[a-z0-9][a-z0-9-]{0,63}`.

During project-scoped Register, create `<current-project>`'s missing `.noisy_room` and `.noisy_room/local-skill` components one at a time with plain `mkdir`, never `mkdir -p`. During global Register, require `<codex-home>` to exist as a real directory, then create only its missing `state`, `state/plugins`, `state/plugins/noisy`, and `state/plugins/noisy/local-skill` components one at a time; never create the Codex home itself. During confirmed Apply, independently create the current project's missing `.noisy_room`, `.noisy_room/local-skill`, `.agents`, and `.agents/skills` components one at a time. If `mkdir` reports an existing path, revalidate its type and symlink status. Track directories created by this invocation and remove them in reverse order with `rmdir` if the operation stops while they remain empty. If the selected registry root is not writable, request write authorization for that exact path when the host supports it; if authorization is denied or unavailable, report the path and stop. Never fall back to the other scope.

Treat the ledger as the only proof that this manager owns a destination. Use this schema:

```json
{
  "schema": 1,
  "generation": 1,
  "installs": [
    {
      "destination": "skill-name",
      "catalog_id": "owner/repository#path/to/skill",
      "source_url": "https://github.com/owner/repository",
      "source_path": "path/to/skill",
      "commit": "full-git-commit-sha",
      "tree_oid": "git-tree-oid",
      "installed_fingerprint": "sha256",
      "declared_name": "skill-name",
      "installed_at": "YYYY-MM-DD HH:mm:ss UTC",
      "updated_at": "YYYY-MM-DD HH:mm:ss UTC"
    }
  ]
}
```

Require a regular, non-symlinked ledger when it exists. Validate its complete schema, unique destinations, unique catalog IDs, full commit/tree identifiers, installed fingerprints, and monotonically increasing non-negative generation before trusting it. Treat a destination without a matching ledger record as unmanaged. Never overwrite, adopt, update, or uninstall an unmanaged destination.

Treat a missing ledger as the canonical empty state `{ "schema": 1, "generation": 0, "installs": [] }` and create it only as part of a confirmed first mutation. Never patch the live ledger in place. Use `apply_patch` to build and validate `state.next.json` and any missing canonical `state.previous.json` inside the transaction, then commit with the exact moves defined in Apply.

## Source registry

- Store one canonical URL per non-empty line in `sources.list` using `https://github.com/<owner>/<repository>`, without `.git`, trailing slash, query, fragment, credentials, port, or additional path components.
- Compare canonical URLs case-insensitively, reject malformed entries and duplicates, preserve order, and require a regular non-symlinked file when it exists.
- Permit a missing or empty registry only in Register mode. In other networked modes, explain how to use `--register` and stop without project mutation.
- Re-read, validate, and fingerprint the registry immediately before and after mutation. Acquire only `<registry-root>/register.lock/` atomically with `mkdir`; never break an existing lock automatically.
- Use `apply_patch` for registry changes. Create no helper file that contains executable code.

After successfully creating the selected registry lock or current-project apply lock, generate a unique nonce with a direct system command and use `apply_patch` to write `owner.json` containing that nonce, the operation, target path, registry scope when applicable, and UTC creation time. Before release, require the same nonce, delete only `owner.json` with `apply_patch`, then remove the empty lock directory with `rmdir`. If ownership cannot be verified, retain the lock and report it. A networked Apply uses the registry lock as an exclusive read-stability lock; acquire it before the current-project apply lock so every operation uses one lock order.

For every final skill or ledger placement, require a host-provided atomic no-replace rename primitive. Probe its file and directory behavior inside the transaction before moving managed data. Arrange staged sources with the final basename and target the verified parent so an existing destination cannot become a nesting target. Never fall back to an overwriting or ordinary `mv`; if no verified no-replace primitive is available, retain staging and stop before moving any existing destination.

## Catalog discovery

1. Create an exact task-specific directory with `mktemp -d`. Shallow-clone each required canonical URL using `git clone --depth 1 -- <url> <destination>`, and record its default branch, full `HEAD` SHA, and source key.
2. For Browse, Install, Update, Replace, and every networked Apply, rediscover every registered source and abort the whole catalog if any source fails. This full-registry domain is the only networked catalog domain, so Preview and Apply always compute the catalog fingerprint from the same records. Uninstall requires no network.
3. Find skills with `rg --files --hidden -g 'SKILL.md'`. Exclude `.git`, `.venv`, `node_modules`, `vendor`, `test`, `tests`, `fixture`, `fixtures`, `example`, and `examples` only when they are complete directory segments.
4. Treat the directory containing an accepted `SKILL.md` as the skill root. Validate YAML frontmatter with exactly one string `name` matching the root folder and the safe destination pattern. Reject nested accepted skill roots, submodules, symlinks, special files, control characters in paths, and a skill root that is itself a `.codex-plugin` or `.claude-plugin` root.
5. Inspect `SKILL.md`, `agents/openai.yaml`, and bundled text/resources for declared filesystem and plugin dependencies. Resolve relative paths against the skill root. Reject the skill when a required path escapes that root, a bundled dependency is unresolved, or execution requires an enclosing plugin's commands, hooks, agents, MCP server, or other capability that is not independently available. Treat an unverifiable required plugin-relative dependency as non-installable and report why.
6. Use plugin manifests only for source and packaging labels. Never copy a plugin root. Export only the recorded Git tree for the skill root into a clean temporary directory with direct `git archive` and `tar` commands; never copy `.git`, untracked files, or an enclosing directory. Revalidate the export and compute its destination-format fingerprint as `source_fingerprint`. Record only the exact skill root's canonical URL, repository-relative path, commit, Git tree OID, source fingerprint, declared name, and destination.
7. Build the stable catalog ID as the lowercase `owner/repository` slug, `#`, and the exact repository-relative skill path. Reject duplicate IDs and group destination collisions case-insensitively; never silently rename a destination.
8. Compute a deterministic catalog fingerprint from the sorted canonical records. Always clean the exact clone directory after use, including failure paths.

Discovery is complete only when every accepted skill maps to one safe, unambiguous catalog record.

## Fingerprints

Use SHA-256 and lowercase hexadecimal output everywhere:

- **Registry:** hash the UTF-8 bytes of each canonical URL plus one LF, in registry order. Treat a missing or empty registry as empty bytes.
- **Catalog:** sort records bytewise by catalog ID. For each record, emit one minified UTF-8 JSON object plus LF with keys ordered as `catalog_id`, `source_url`, `source_path`, `commit`, `tree_oid`, `source_fingerprint`, `declared_name`, and `destination`; hash the concatenation. An uninstall-only catalog is empty bytes.
- **Ledger:** sort installs bytewise by destination. Emit one minified UTF-8 JSON object plus LF with top-level keys ordered as `schema`, `generation`, and `installs`, and install keys in the schema's displayed order. Hash those bytes. Use the canonical empty state for a missing ledger.
- **Destination:** walk without following links and reject non-regular entries or control characters. Sort entries bytewise by relative path. Emit `D`, NUL, octal permission bits, NUL, relative path, NUL for each directory. Emit `F`, NUL, octal permission bits, NUL, byte size, NUL, SHA-256 file-content digest, NUL, relative path, NUL for each file. Hash the concatenation.

Use direct quoted `find`, `stat`, sorting, and SHA-256 commands appropriate to the host. Data files used to assemble canonical bytes are transaction data, not executable helpers; create or change them with `apply_patch` and remove only the exact verified temporary copies.

## Register

1. Resolve the manager's registry scope and exact registry path, report both, then accept exactly one HTTPS GitHub repository URL. Normalize one optional `.git` suffix and one optional trailing slash, then enforce the canonical registry format.
2. If the canonical URL is already registered, report an idempotent no-op and continue to Browse.
3. Clone and fully validate the candidate. Require at least one accepted skill.
4. Under the registration lock, independently re-resolve the active manager discovery entry and require the same scope and registry path, then rediscover the complete prospective registry including the candidate. Release the owned lock and stop if scope changed. Do not mutate the registry if the resulting catalog is invalid.
5. Recheck the registry fingerprint, add the URL once with `apply_patch`, and verify the complete file afterward. If verification fails, restore its exact previous contents and report the failure.
6. Release only the lock created by this invocation, clean temporary clones, report the registered source, candidate `HEAD`, registry scope, and absolute registry path, then run a fresh Browse pass against that same scope.

## Browse and Preview

For Browse, Install, and Update, resolve the active manager's registry scope, display it, and run Discovery against only that registry. For Uninstall, build the Preview from the current-project ledger and local destinations without cloning, resolving, or requiring a registry. Reconcile the resulting records with the current destination paths:

- **Available**: catalog record has no destination and no ledger record.
- **Current**: ledger record and destination exist, its current fingerprint equals `installed_fingerprint`, and recorded tree OID equals the catalog tree OID.
- **Update available**: the same catalog ID is managed but its recorded tree OID differs.
- **Replacement available**: another catalog ID targets a managed destination.
- **Locally modified**: the managed destination's current fingerprint differs from `installed_fingerprint`; preserve it and show a warning before Update, Replace, or Uninstall.
- **Orphaned**: a managed record is absent from the fresh catalog; allow keeping or recoverable uninstall, but not update.
- **Conflict**: a destination exists without a matching ledger record, has the wrong type, or is symlinked; show it but permit no mutation.
- **Inconsistent**: ledger and destination disagree; stop mutations affecting it and report the repair needed.

For `--install`, `--uninstall`, or `--update`, resolve qualified IDs exactly. Accept a short declared name or destination only when it resolves uniquely in the relevant catalog or ledger. Apply the requested choices to the initial Preview selection; never mutate immediately.

Use the available Visualize skill and follow its current `SKILL.md`. Write the fragment with `apply_patch` in the thread visualization directory, outside the project. Render:

- Search and one section per source.
- Desired-installed checkboxes and tri-state source/all controls.
- Status, source, destination, and installed/update labels.
- An explicit update checkbox for each managed skill with an update available. Do not select updates implicitly.
- Mutually exclusive choices for catalog records sharing one destination.
- Read-only conflict and inconsistent rows.
- Live install, update/replace, uninstall, keep, and ignored counts.
- A disabled **Apply changes** button until the plan differs from the baseline.

The UI performs no filesystem or network action. On **Apply changes**, call `window.openai.sendFollowUpMessage` with a confirmation title and a prompt containing `$noisy:local-skill NOISY_LOCAL_SKILL_APPLY_V1` followed by exactly one JSON object:

```json
{
  "protocol": "NOISY_LOCAL_SKILL_APPLY_V1",
  "target_project": "/absolute/project",
  "registry_scope": "global",
  "registry_path": "/absolute/codex-home/state/plugins/noisy/local-skill/sources.list",
  "desired_ids": ["owner/repository#path/to/skill"],
  "update_ids": [],
  "catalog_fingerprint": "sha256",
  "registry_fingerprint": "sha256",
  "state_generation": 1,
  "state_fingerprint": "sha256",
  "destination_fingerprints": {},
  "plan": {
    "install": [],
    "update": [],
    "replace": [],
    "uninstall": []
  }
}
```

Use qualified IDs in every payload array. Compute destination fingerprints over sorted relative paths, file types, modes, and SHA-256 file contents; reject control characters so the direct command pipeline is unambiguous. Include fingerprints for every destination the plan may move or replace.

Use only these exact operation-object schemas, with no extra keys:

- `install` and `update`: `{ "catalog_id": "owner/repository#path/to/skill", "destination": "skill-name" }`.
- `replace`: `{ "from_catalog_id": "owner/old#path", "to_catalog_id": "owner/new#path", "destination": "skill-name" }`.
- `uninstall`: `{ "catalog_id": "owner/repository#path/to/skill", "destination": "skill-name" }`.

Sort each operation array bytewise by destination and then by its displayed ID fields. Require each affected destination to appear exactly once across all four arrays. Derive these objects from the baseline ledger, full catalog, `desired_ids`, and `update_ids`; never accept a payload operation that cannot be recomputed from those inputs.

For every plan containing Install, Update, or Replace, bind `registry_scope` to `"global"` or `"project"` and `registry_path` to the canonical absolute path selected from the active manager discovery entry. When the final plan contains only Uninstall operations, set `registry_scope` to `"none"`, set `registry_path` to `null`, and use the defined empty registry and catalog fingerprints regardless of whether Preview began from Browse or `--uninstall`. Do not resolve or bind that plan to `sources.list`.

End the turn after rendering. If Visualize is unavailable, show the same catalog and exact plan as a numbered list, then wait for explicit confirmation that generates the same protocol payload.

## Apply

1. Parse only the protocol JSON object. Require exact keys and types, an absolute real current-project path, `registry_scope` in `"global"`, `"project"`, or `"none"`, a canonical absolute `registry_path` for networked plans and `null` for uninstall-only plans, sorted duplicate-free ID arrays, and plan operation arrays that agree with the desired and update sets.
2. Re-read the ledger and destination state. For any plan containing Install, Update, or Replace, independently re-resolve the active manager discovery entry and require its scope and computed canonical registry path to equal the payload before reading that registry or rediscovering the full registered-source catalog. For an uninstall-only plan, require `"none"` and `null`, do not resolve a registry, and do not read or validate `sources.list`; use the defined empty registry and catalog fingerprints. Recompute the complete plan and all applicable fingerprints. If manager scope/path, source SHA/tree/fingerprint, registry, catalog, ledger generation, ledger fingerprint, destination fingerprint, collision, or operation differs from the confirmed payload, stop without mutation and require a new Preview.
3. Create and validate missing current-project state and skills parent directories as defined above. For a networked plan, first require the selected registry root and registry file to remain present and valid, then acquire `<registry-root>/register.lock/` atomically with `mkdir` and mark its owned operation as `apply-read`; do not create or mutate registry state during Apply. Then acquire only `<current-project>/.noisy_room/local-skill/apply.lock/` atomically with `mkdir` and write its ownership record. An uninstall-only plan acquires no registry lock. If acquiring the apply lock fails, release the verified registry lock owned by this invocation. Never break an existing or stale lock automatically. After acquiring all applicable locks, repeat every state, destination, scope, registry-path, registry, catalog, and plan check.
4. Create a unique transaction directory inside `.noisy_room/local-skill`. Stage every install, content-changing update, and replacement there with direct quoted `mkdir`, `git archive`, `tar`, and `mv` commands using `--` where supported. Export only the exact catalog skill root at the confirmed commit; never stage `.git`, untracked files, or its enclosing plugin.
5. Verify every staged tree contains its root `SKILL.md`, contains only regular directories/files, has the declared name, and has a destination fingerprint equal to the catalog record's `source_fingerprint`. Record that value as `installed_fingerprint`. Build and validate the complete next ledger as `state.next.json` with generation incremented exactly once. Do this before moving any existing destination.
6. Move each exact ledger-owned update, replacement, and uninstall destination into its unique absent transaction recovery path. Place staged installs, updates, and replacements only with the verified atomic no-replace primitive. Never permanently delete an existing skill and never treat a no-op move as success.
7. If the live ledger exists, move it into the transaction as `state.previous.json`; otherwise create and validate the canonical empty `state.previous.json` there and confirm the live path remains absent. Place `state.next.json` at the absent live ledger path only with the verified atomic no-replace primitive. Verify every destination and ledger record. If any move, ledger change, or verification fails, move new destinations back into the transaction, move any newly placed live ledger back as `state.failed.json`, restore every old destination with no-replace placement, restore `state.previous.json` only when a live ledger existed before the transaction, require the live ledger path to be absent otherwise, retain the transaction for diagnosis, and report any incomplete rollback precisely.
8. On success, move the complete transaction, including old folders and the previous ledger, to `.noisy_room/local-skill/trash/<UTC-timestamp>-<unique-suffix>/`. Release only this invocation's apply lock, then its registry lock when present. After a complete rollback, release both owned locks in that order. After an incomplete rollback, retain the apply lock and report its exact path for manual recovery, but release the read-only registry lock after recording the final registry fingerprint.
9. Report installed, updated, replaced, kept, uninstalled, ignored, failed, and recovery paths. Tell the user to start a new Codex task before invoking newly installed or updated skills.

Apply is complete only when the recomputed plan exactly matches the confirmed plan, every requested destination is accounted for, the ledger matches the filesystem, and no unmanaged destination changed.

## Operation rules

- **Install:** require the destination to remain absent and unmanaged, then add its provenance record.
- **Update:** require the same managed catalog ID, stage the current catalog tree first, preserve the old folder, and update commit/tree/timestamp provenance. Report a newer source commit with the same tree as content-current rather than requiring replacement.
- **Replace:** require one selected record for the managed destination, preserve the old folder, and replace its provenance record.
- **Uninstall:** use only the ledger and local destination; require no source clone, move the exact managed folder to recovery, and remove only its provenance record.

Before Update or Replace, compare the managed folder with a checkout of its recorded commit when available and show local modifications in Preview. If that comparison is unavailable or modifications exist, show that warning in the confirmation and bind the current destination fingerprint into the payload. Always preserve the full old folder.
