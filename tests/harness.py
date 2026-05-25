from __future__ import annotations

import json
import os
import platform
import re
import shutil
import shlex
import signal
import subprocess
import sys
import tempfile
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Iterable, TypedDict


REPO_ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = REPO_ROOT / "tests"
DEFAULT_RUNS_DIR = Path(tempfile.gettempdir()) / "noisy-room-tests"
RUNS_DIR = Path(os.environ.get("NOISY_TEST_RUNS_DIR", str(DEFAULT_RUNS_DIR))).expanduser()
TASKMD_SKILL_DIR = REPO_ROOT / "plugins" / "noisy" / "skills" / "tmd"
GEMINI_TASKMD_COMMAND = REPO_ROOT / ".gemini" / "commands" / "noisy" / "tmd.toml"
VERIFIER_SCHEMA = TESTS_DIR / "schemas" / "verifier-result.schema.json"

TASK_DOC_SECTIONS = ["Goal", "Knowledge", "Worklog", "Archived", "Roadmap"]
DATED_ENTRY = re.compile(r"^### \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC - .+")
ROADMAP_ID_PATTERN = r"(?:R\d{3}|R[0-9A-F]{6,8}-\d{3})"
ROADMAP_ENTRY = re.compile(rf"^### ({ROADMAP_ID_PATTERN}) - .+")
UTC_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$")
ROADMAP_ID = re.compile(rf"^{ROADMAP_ID_PATTERN}$")
ROADMAP_ID_DESCRIPTION = "legacy R### or doc-keyed R<DOCKEY>-<NNN>"
ROADMAP_RATIONALE = "Rationale:"
ROADMAP_TASK = "Task:"
ROADMAP_COMPLETE_NOTE = "(no more tasks)"


@dataclass(frozen=True)
class CodexExecutionProfile:
    name: str
    flags: tuple[str, ...]
    timeout_seconds: int = 600
    binary: str = "codex"

    def command(
        self,
        workspace: Path,
        prompt: str,
        *,
        output_last_message: Path | None = None,
        output_schema: Path | None = None,
    ) -> list[str]:
        command = [
            self.binary,
            "exec",
            "-C",
            str(workspace),
            "--color",
            "never",
            *self.flags,
        ]
        if output_schema is not None:
            command.extend(["--output-schema", str(output_schema)])
        if output_last_message is not None:
            command.extend(["-o", str(output_last_message)])
        command.append(prompt)
        return command


PERMISSIVE_PROFILE = CodexExecutionProfile(
    name="permissive-bypass",
    flags=(
        "--skip-git-repo-check",
        "--ephemeral",
        "--dangerously-bypass-approvals-and-sandbox",
    ),
)

CODEX_JSON_PROFILE = CodexExecutionProfile(
    name="permissive-bypass-json",
    flags=(
        *PERMISSIVE_PROFILE.flags,
        "--json",
    ),
    timeout_seconds=900,
)


@dataclass(frozen=True)
class GeminiExecutionProfile:
    name: str
    flags: tuple[str, ...]
    output_format: str = "text"
    timeout_seconds: int = 600

    def command(self, prompt: str) -> list[str]:
        return [
            "gemini",
            "--prompt",
            prompt,
            "--output-format",
            self.output_format,
            *self.flags,
        ]


GEMINI_YOLO_PROFILE = GeminiExecutionProfile(
    name="gemini-yolo",
    flags=(
        "--skip-trust",
        "--approval-mode",
        "yolo",
    ),
)

GEMINI_YOLO_STREAM_PROFILE = GeminiExecutionProfile(
    name="gemini-yolo-stream",
    flags=GEMINI_YOLO_PROFILE.flags,
    output_format="stream-json",
)


@dataclass(frozen=True)
class CommandResult:
    label: str
    command: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False
    launch_error: str | None = None

    def assert_success(self) -> None:
        assert self.returncode == 0, (
            f"{self.label} failed with exit code {self.returncode}\n"
            f"Command: {shlex.join(self.command)}\n"
            f"Timed out: {self.timed_out}\n"
            f"Launch error: {self.launch_error or 'none'}\n"
            f"STDOUT:\n{self.stdout}\n\nSTDERR:\n{self.stderr}"
        )


class VerifierResult(TypedDict):
    passed: bool
    summary: str
    issues: list[str]


class TestRun:
    def __init__(self, name: str) -> None:
        run_id = uuid.uuid4().hex[:8]
        self.name = name
        self.run_dir = (RUNS_DIR / f"{name}-{run_id}").resolve()
        self.workspace = self.run_dir / "workspace"
        self.artifacts = self.run_dir / "artifacts"
        self._command_count = 0
        self.workspace.mkdir(parents=True)
        self.artifacts.mkdir(parents=True)
        self._write_run_metadata()
        self._wire_skill()

    def cleanup(self) -> None:
        shutil.rmtree(self.run_dir)

    def write_source(self, name: str | os.PathLike[str], content: str) -> Path:
        relative_path = Path(name)
        assert not relative_path.is_absolute(), f"Source path must be relative: {relative_path}"
        path = (self.workspace / relative_path).resolve()
        assert path.is_relative_to(self.workspace.resolve()), (
            f"Source path must stay inside workspace: {relative_path}"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def workspace_file_hashes(self) -> dict[str, str]:
        hashes: dict[str, str] = {}
        for root, dirs, files in os.walk(self.workspace, followlinks=False):
            dirs[:] = [directory for directory in dirs if directory not in {".codex", ".gemini"}]
            for filename in files:
                path = Path(root) / filename
                if path.is_symlink():
                    continue
                relative = path.relative_to(self.workspace).as_posix()
                hashes[relative] = sha256(path.read_bytes()).hexdigest()
        return hashes

    def run_command(
        self,
        command: list[str],
        *,
        label: str,
        cwd: Path | None = None,
        env: Mapping[str, str] | None = None,
        timeout_seconds: int = 120,
    ) -> CommandResult:
        command_tuple = tuple(command)
        try:
            process = subprocess.Popen(
                command,
                cwd=cwd or self.workspace,
                env={**os.environ, **env} if env is not None else None,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=os.name != "nt",
            )
        except OSError as error:
            command_result = CommandResult(
                label=label,
                command=command_tuple,
                returncode=-1,
                stdout="",
                stderr=f"{type(error).__name__}: {error}",
                launch_error=f"{type(error).__name__}: {error}",
            )
            self._write_command_artifacts(command_result)
            command_result.assert_success()

        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                process.kill()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            stdout, stderr = process.communicate()
            command_result = CommandResult(
                label=label,
                command=command_tuple,
                returncode=-124,
                stdout=stdout or "",
                stderr=(stderr or "") + f"\nTimed out after {timeout_seconds} seconds.",
                timed_out=True,
            )
            self._write_command_artifacts(command_result)
            command_result.assert_success()

        command_result = CommandResult(
            label=label,
            command=command_tuple,
            returncode=process.returncode,
            stdout=stdout or "",
            stderr=stderr or "",
        )
        self._write_command_artifacts(command_result)
        return command_result

    def codex_exec(
        self,
        prompt: str,
        *,
        label: str,
        profile: CodexExecutionProfile = PERMISSIVE_PROFILE,
        env: Mapping[str, str] | None = None,
        output_last_message: Path | None = None,
        output_schema: Path | None = None,
    ) -> CommandResult:
        command = profile.command(
            self.workspace,
            prompt,
            output_last_message=output_last_message,
            output_schema=output_schema,
        )
        before_status = self._repo_status()
        captured_error: AssertionError | None = None
        result: CommandResult | None = None
        try:
            result = self.run_command(
                command,
                label=label,
                env=env,
                timeout_seconds=profile.timeout_seconds,
            )
        except AssertionError as error:
            captured_error = error

        mutation_error = self._repo_mutation_error(label, before_status, self._repo_status())
        if captured_error and mutation_error:
            raise AssertionError(f"{captured_error}\n\n{mutation_error}") from captured_error
        if mutation_error:
            raise AssertionError(mutation_error)
        if captured_error:
            raise captured_error
        assert result is not None
        return result

    def gemini_exec(
        self,
        prompt: str,
        *,
        label: str,
        profile: GeminiExecutionProfile = GEMINI_YOLO_PROFILE,
    ) -> CommandResult:
        command = profile.command(prompt)
        before_status = self._repo_status()
        captured_error: AssertionError | None = None
        result: CommandResult | None = None
        try:
            result = self.run_command(
                command,
                label=label,
                env={"GEMINI_CLI_TRUST_WORKSPACE": "true"},
                timeout_seconds=profile.timeout_seconds,
            )
        except AssertionError as error:
            captured_error = error

        mutation_error = self._repo_mutation_error(label, before_status, self._repo_status())
        if captured_error and mutation_error:
            raise AssertionError(f"{captured_error}\n\n{mutation_error}") from captured_error
        if mutation_error:
            raise AssertionError(mutation_error)
        if captured_error:
            raise captured_error
        assert result is not None
        return result

    def verify_new_task_doc_semantics(self, *, source: Path, task_doc: Path) -> VerifierResult:
        output_path = self.artifacts / "verifier-result.json"
        prompt = f"""
You are the semantic verifier for the Noisy Room Taskmd Skill test harness.

Read these files in the current workspace:
- Source brief: {self._relative_workspace_path(source)}
- Generated task doc: {self._relative_workspace_path(task_doc)}

Return JSON matching the provided schema. Set passed=true only when all are true:
- The generated task doc's Goal matches the source brief's requested work.
- The generated task doc clearly represents task planning/state, not completed implementation.
- Knowledge captures stable constraints or references from the source brief.
- Knowledge treats the source brief as reference-only and does not expand scope to editing it.
- Roadmap contains at least one concrete next action that would advance the source brief's work.
- Roadmap does not tell the next agent to edit the source brief unless the source brief explicitly requested that.

If any check fails, set passed=false and list concise issues. Do not edit files.
""".strip()
        result = self.codex_exec(
            prompt,
            label="codex-verifier",
            output_schema=VERIFIER_SCHEMA,
            output_last_message=output_path,
        )
        result.assert_success()
        return _load_verifier_result(output_path)

    def _write_run_metadata(self) -> None:
        codex_path = shutil.which("codex")
        gemini_path = shutil.which("gemini")
        codex_version = _version_string(codex_path)
        gemini_version = _version_string(gemini_path)
        metadata = {
            "codex_path": codex_path,
            "codex_version": codex_version,
            "gemini_path": gemini_path,
            "gemini_taskmd_command": str(GEMINI_TASKMD_COMMAND),
            "gemini_version": gemini_version,
            "python": sys.version,
            "platform": platform.platform(),
            "repo_root": str(REPO_ROOT),
            "run_dir": str(self.run_dir),
            "workspace": str(self.workspace),
            "taskmd_skill_dir": str(TASKMD_SKILL_DIR),
            "runs_dir_env": os.environ.get("NOISY_TEST_RUNS_DIR"),
        }
        (self.artifacts / "run-metadata.json").write_text(
            json.dumps(metadata, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def _relative_workspace_path(self, path: Path) -> Path:
        return path.resolve().relative_to(self.workspace.resolve())

    def _repo_status(self) -> str:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=all"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
        if result.returncode != 0:
            return f"<git status failed>\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        return result.stdout

    def _repo_mutation_error(self, label: str, before: str, after: str) -> str | None:
        if before == after:
            return None
        artifact_base = self.artifacts / f"repo-status-after-{_safe_label(label)}"
        artifact_base.with_suffix(".before.txt").write_text(before, encoding="utf-8")
        artifact_base.with_suffix(".after.txt").write_text(after, encoding="utf-8")
        return (
            f"{label} changed git-visible files outside the test workspace.\n"
            f"Before status artifact: {artifact_base.with_suffix('.before.txt')}\n"
            f"After status artifact: {artifact_base.with_suffix('.after.txt')}"
        )

    def _wire_skill(self) -> None:
        self._wire_codex_skill()
        self._wire_gemini_skill()

    def _wire_codex_skill(self) -> None:
        skill_root = self.workspace / ".codex" / "skills"
        skill_root.mkdir(parents=True, exist_ok=True)
        skill_link = skill_root / "noisy:tmd"
        skill_link.symlink_to(TASKMD_SKILL_DIR, target_is_directory=True)

    def _wire_gemini_skill(self) -> None:
        skill_root = self.workspace / ".gemini" / "skills"
        skill_root.mkdir(parents=True, exist_ok=True)
        skill_link = skill_root / "tmd"
        skill_link.symlink_to(TASKMD_SKILL_DIR, target_is_directory=True)

        command_root = self.workspace / ".gemini" / "commands" / "noisy"
        command_root.mkdir(parents=True, exist_ok=True)
        command_link = command_root / "tmd.toml"
        command_link.symlink_to(GEMINI_TASKMD_COMMAND)

    def _write_command_artifacts(self, result: CommandResult) -> None:
        self._command_count += 1
        safe_label = _safe_label(result.label)
        base = self.artifacts / f"{self._command_count:02d}-{safe_label}"
        base.with_suffix(".command.txt").write_text(shlex.join(result.command), encoding="utf-8")
        base.with_suffix(".stdout.txt").write_text(result.stdout, encoding="utf-8")
        base.with_suffix(".stderr.txt").write_text(result.stderr, encoding="utf-8")
        base.with_suffix(".result.json").write_text(
            json.dumps(
                {
                    "label": result.label,
                    "returncode": result.returncode,
                    "timed_out": result.timed_out,
                    "launch_error": result.launch_error,
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )


def _load_verifier_result(output_path: Path) -> VerifierResult:
    try:
        verifier_result = json.loads(output_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise AssertionError(f"Verifier did not write valid JSON to {output_path}: {error}") from error
    assert isinstance(verifier_result, dict), "Verifier result should be a JSON object"
    assert isinstance(verifier_result.get("passed"), bool), "Verifier result missing boolean 'passed'"
    assert isinstance(verifier_result.get("summary"), str), "Verifier result missing string 'summary'"
    issues = verifier_result.get("issues")
    assert isinstance(issues, list) and all(isinstance(issue, str) for issue in issues), (
        "Verifier result missing string array 'issues'"
    )
    return {
        "passed": verifier_result["passed"],
        "summary": verifier_result["summary"],
        "issues": issues,
    }


def _safe_label(label: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", label).strip("-")


def _version_string(binary_path: str | None) -> str:
    if not binary_path:
        return ""
    try:
        version_result = subprocess.run(
            [binary_path, "--version"],
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return f"<version unavailable: {type(error).__name__}: {error}>"
    return (version_result.stdout or version_result.stderr).strip()


def create_test_run(name: str) -> TestRun:
    if not TASKMD_SKILL_DIR.exists():
        raise AssertionError(f"Taskmd skill directory does not exist: {TASKMD_SKILL_DIR}")
    if not GEMINI_TASKMD_COMMAND.exists():
        raise AssertionError(f"Gemini tmd command does not exist: {GEMINI_TASKMD_COMMAND}")
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    return TestRun(name)


def should_keep_runs(test_failed: bool) -> bool:
    keep_all = os.environ.get("NOISY_KEEP_TEST_ENVS") == "1"
    return keep_all or test_failed


def find_single_task_doc(workspace: Path) -> Path:
    task_docs = sorted((workspace / ".noisy_room" / "tasks").glob("*.md"))
    assert len(task_docs) == 1, f"Expected exactly one task doc, found {len(task_docs)}: {task_docs}"
    task_doc = task_docs[0]
    assert re.fullmatch(r"[a-z0-9][a-z0-9-]*\.md", task_doc.name), (
        f"Task doc filename should be lowercase hyphenated slug: {task_doc.name}"
    )
    return task_doc


def validate_single_new_task_doc(
    workspace: Path,
    *,
    source_name: str,
    expected_agent: str = "codex-cli",
) -> Path:
    task_doc = find_single_task_doc(workspace)
    validate_new_task_doc_contract(task_doc, source_name=source_name, expected_agent=expected_agent)
    return task_doc


def metadata_records(task_doc: Path, section: str) -> list[dict[str, object]]:
    assert section in TASK_DOC_SECTIONS, f"Unknown task doc section: {section}"
    return _collect_metadata(task_doc.read_text(encoding="utf-8").splitlines())[section]


def codex_stream_events(result: CommandResult) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for line_number, line in enumerate(result.stdout.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or not stripped.startswith("{"):
            continue
        try:
            event = json.loads(stripped)
        except json.JSONDecodeError as error:
            raise AssertionError(
                f"Codex JSON stdout line {line_number} starts like JSON but is invalid: {line}"
            ) from error
        assert isinstance(event, dict), (
            f"Codex JSON stdout line {line_number} should decode to an object: {line}"
        )
        events.append(event)
    assert events, "Codex --json stdout should contain JSON events"
    return events


def codex_stream_assistant_text(events: Iterable[Mapping[str, object]]) -> str:
    chunks: list[str] = []
    for event in events:
        if event.get("type") != "item.completed":
            continue
        item = event.get("item")
        if not isinstance(item, Mapping) or item.get("type") != "agent_message":
            continue
        text = item.get("text")
        if isinstance(text, str):
            chunks.append(text)
    return "\n".join(chunks)


def assert_codex_stream_spawned_subagents(
    events: Iterable[Mapping[str, object]],
    *,
    min_count: int,
) -> None:
    event_list = list(events)
    spawned_thread_ids: list[str] = []
    for event in event_list:
        if event.get("type") != "item.completed":
            continue
        item = event.get("item")
        if not isinstance(item, Mapping):
            continue
        if item.get("type") != "collab_tool_call" or item.get("tool") != "spawn_agent":
            continue
        receiver_thread_ids = item.get("receiver_thread_ids")
        if isinstance(receiver_thread_ids, list):
            spawned_thread_ids.extend(
                thread_id for thread_id in receiver_thread_ids if isinstance(thread_id, str)
            )
    assert len(spawned_thread_ids) >= min_count, (
        f"Codex should spawn at least {min_count} subagent thread(s); "
        f"saw spawned thread ids: {spawned_thread_ids}"
    )

    completed_thread_ids: set[str] = set()
    for event in event_list:
        if event.get("type") != "item.completed":
            continue
        item = event.get("item")
        if not isinstance(item, Mapping):
            continue
        if item.get("type") != "collab_tool_call" or item.get("tool") != "wait":
            continue
        agents_states = item.get("agents_states")
        if not isinstance(agents_states, Mapping):
            continue
        for thread_id, state in agents_states.items():
            if isinstance(thread_id, str) and isinstance(state, Mapping):
                if state.get("status") == "completed":
                    completed_thread_ids.add(thread_id)
    assert len(completed_thread_ids) >= min_count, (
        f"Codex should wait for at least {min_count} completed subagent thread(s); "
        f"saw completed thread ids: {sorted(completed_thread_ids)}"
    )


def gemini_stream_events(result: CommandResult) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for line_number, line in enumerate(result.stdout.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise AssertionError(
                f"Gemini stream-json stdout line {line_number} is not valid JSON: {line}"
            ) from error
        assert isinstance(event, dict), (
            f"Gemini stream-json stdout line {line_number} should decode to an object: {line}"
        )
        events.append(event)
    assert events, "Gemini stream-json stdout should contain events"
    return events


def gemini_stream_assistant_text(events: Iterable[Mapping[str, object]]) -> str:
    chunks: list[str] = []
    for event in events:
        if event.get("type") == "message" and event.get("role") == "assistant":
            content = event.get("content")
            if isinstance(content, str):
                chunks.append(content)
    return "".join(chunks)


def assert_gemini_stream_invoked_subagent(
    events: Iterable[Mapping[str, object]],
    *,
    agent_name: str,
    min_count: int = 1,
) -> None:
    event_list = list(events)
    invoke_events: list[Mapping[str, object]] = []
    for event in event_list:
        if event.get("type") != "tool_use" or event.get("tool_name") != "invoke_agent":
            continue
        parameters = event.get("parameters")
        if isinstance(parameters, Mapping):
            invoke_events.append(parameters)
    matching_events = [
        parameters for parameters in invoke_events if parameters.get("agent_name") == agent_name
    ]
    assert len(matching_events) >= min_count, (
        f"Gemini should invoke the {agent_name!r} subagent via invoke_agent "
        f"at least {min_count} time(s); "
        f"saw invoke_agent parameters: {invoke_events}"
    )
    assert any(
        event.get("type") == "result" and event.get("status") == "success"
        for event in event_list
    ), "Gemini stream-json should finish with a success result event"


def validate_new_task_doc_contract(
    task_doc: Path,
    *,
    source_name: str,
    expected_agent: str = "codex-cli",
) -> None:
    text = task_doc.read_text(encoding="utf-8")
    lines = text.splitlines()

    assert lines, "Task doc is empty"
    assert lines[0].startswith("# "), "Task doc must start with a level-1 title"
    assert source_name in text, f"Task doc should reference source file {source_name!r}"

    sections = [line[3:].strip() for line in lines if line.startswith("## ")]
    assert sections == TASK_DOC_SECTIONS, (
        f"Task doc sections must be exactly {TASK_DOC_SECTIONS}; found {sections}"
    )
    section_text = _section_text(lines)
    knowledge = section_text["Knowledge"].lower()
    roadmap = section_text["Roadmap"].lower()
    assert source_name in section_text["Knowledge"], f"Knowledge should list {source_name!r}"
    assert "reference" in knowledge, "Knowledge should mark source docs as reference material"
    source_is_read_only = "read-only" in knowledge
    source_has_no_edit_warning = ("do not" in knowledge or "must not" in knowledge) and (
        "modify" in knowledge
        or "modified" in knowledge
        or "modification" in knowledge
        or "edit" in knowledge
    )
    assert source_is_read_only or source_has_no_edit_warning, (
        "Knowledge should say the source/reference docs must not be modified"
    )
    assert not re.search(rf"\b(edit|modify|update|change)\b[^\n]*\b{re.escape(source_name.lower())}\b", roadmap), (
        f"Roadmap should not ask future work to edit {source_name!r}"
    )

    metadata_by_section = _collect_metadata(lines)
    worklog_metadata = metadata_by_section["Worklog"]
    assert worklog_metadata, "Creation should add at least one Worklog record"
    assert all(record.get("trigger") == "revisit" for record in worklog_metadata), (
        "Creation Worklog metadata should only include trigger='revisit'"
    )
    for record in worklog_metadata:
        assert record.get("agent") == expected_agent, f"Unexpected Worklog agent: {record}"
        assert record.get("session_id"), f"Worklog metadata should include session_id: {record}"
        assert record.get("worklog_id"), f"Worklog metadata should include worklog_id: {record}"

    archived_metadata = metadata_by_section["Archived"]
    assert archived_metadata == [], (
        "Creation should not add Archived entries unless source material has completed/deprecated Roadmap records"
    )
    assert_archived_entries_have_required_shape(lines)

    roadmap_metadata = metadata_by_section["Roadmap"]
    assert roadmap_metadata, "Creation should add at least one Roadmap item"
    for record in roadmap_metadata:
        assert record.get("agent") == expected_agent, f"Unexpected Roadmap agent: {record}"
        assert record.get("session_id"), f"Roadmap metadata should include session_id: {record}"
    assert_roadmap_entries_have_required_shape(lines)


def assert_new_task_doc_side_effects(
    run: TestRun,
    *,
    before: dict[str, str],
    task_doc: Path,
) -> None:
    after = run.workspace_file_hashes()
    task_doc_rel = task_doc.relative_to(run.workspace).as_posix()
    added = set(after) - set(before)
    removed = set(before) - set(after)
    changed = {path for path in set(before) & set(after) if before[path] != after[path]}
    assert removed == set(), f"Creation should not remove existing workspace files: {sorted(removed)}"
    assert changed == set(), f"Creation should not modify existing workspace files: {sorted(changed)}"
    assert added == {task_doc_rel}, (
        f"Creation should only add the task doc; added {sorted(added)}, expected {[task_doc_rel]}"
    )


def _section_text(lines: list[str]) -> dict[str, str]:
    sections: dict[str, list[str]] = {section: [] for section in TASK_DOC_SECTIONS}
    current_section: str | None = None
    for line in lines:
        if line.startswith("## "):
            current_section = line[3:].strip()
            continue
        if current_section in sections:
            sections[current_section].append(line)
    return {section: "\n".join(content).strip() for section, content in sections.items()}


def _collect_metadata(lines: list[str]) -> dict[str, list[dict[str, object]]]:
    metadata: dict[str, list[dict[str, object]]] = {section: [] for section in TASK_DOC_SECTIONS}
    current_section: str | None = None
    for index, line in enumerate(lines):
        if line.startswith("## "):
            current_section = line[3:].strip()
            continue
        if current_section not in {"Worklog", "Archived", "Roadmap"}:
            continue
        if _is_entry_heading(line, current_section):
            metadata[current_section].append(_read_jsonl_metadata(lines, index, current_section))
    return metadata


def assert_roadmap_entries_have_required_shape(
    lines: list[str],
    *,
    allow_empty: bool = False,
) -> None:
    entries = _entries(lines, "Roadmap")
    note = _roadmap_note(lines)
    if allow_empty and not entries:
        assert note == ROADMAP_COMPLETE_NOTE, (
            "Roadmap should use the exact '(no more tasks)' note when no active items remain"
        )
        return
    assert entries, "Roadmap should contain at least one item"
    assert note, "Roadmap should start with a note before active items"
    assert note != ROADMAP_COMPLETE_NOTE, (
        "Roadmap note should be '(no more tasks)' only when no active Roadmap items remain"
    )
    seen_ids: set[str] = set()
    for heading, metadata, body in entries:
        match = ROADMAP_ENTRY.match(heading)
        assert match, (
            f"Roadmap entry heading should start with a Roadmap ID "
            f"({ROADMAP_ID_DESCRIPTION}): {heading}"
        )
        roadmap_id = match.group(1)
        assert roadmap_id not in seen_ids, f"Roadmap id should be unique: {roadmap_id}"
        seen_ids.add(roadmap_id)
        assert metadata.get("id") == roadmap_id, (
            f"Roadmap metadata id should match heading id {roadmap_id}: {metadata}"
        )
        created_at = metadata.get("created_at")
        assert isinstance(created_at, str) and UTC_TIMESTAMP.match(created_at), (
            f"Roadmap metadata created_at should be a UTC timestamp: {metadata}"
        )
        assert "updated_at" not in metadata, f"Roadmap metadata should not include updated_at: {metadata}"
        for field in ("deps", "parallels"):
            values = metadata.get(field)
            assert isinstance(values, list) and all(
                isinstance(value, str) and ROADMAP_ID.match(value) for value in values
            ), (
                f"Roadmap metadata {field} should be an array of Roadmap IDs "
                f"({ROADMAP_ID_DESCRIPTION}): {metadata}"
            )
        body_lines = body.splitlines()
        rationale_lines = [
            index for index, line in enumerate(body_lines) if line.startswith(ROADMAP_RATIONALE)
        ]
        task_lines = [
            index for index, line in enumerate(body_lines) if line.startswith(ROADMAP_TASK)
        ]
        assert len(rationale_lines) == 1, (
            "Roadmap entry body should include exactly one 'Rationale:' line"
        )
        assert len(task_lines) == 1, "Roadmap entry body should include exactly one 'Task:' line"
        rationale_index = rationale_lines[0]
        task_index = task_lines[0]
        assert rationale_index < task_index, "Roadmap entry body should put 'Rationale:' before 'Task:'"
        preface = "\n".join(body_lines[:rationale_index]).strip()
        assert not preface, "Roadmap entry body should start with 'Rationale:'"
        rationale = "\n".join(
            [
                body_lines[rationale_index][len(ROADMAP_RATIONALE):],
                *body_lines[rationale_index + 1:task_index],
            ]
        ).strip()
        task = "\n".join(
            [body_lines[task_index][len(ROADMAP_TASK):], *body_lines[task_index + 1:]]
        ).strip()
        assert rationale, "Roadmap entry Rationale should be non-empty"
        assert task, "Roadmap entry Task should be non-empty"


def assert_archived_entries_have_required_shape(lines: list[str]) -> None:
    entries = _entries(lines, "Archived")
    for heading, metadata, body in entries:
        assert DATED_ENTRY.match(heading), f"Archived entry heading should be dated: {heading}"
        assert metadata.get("type") == "roadmap", (
            f"Archived entries should only store roadmap records: {metadata}"
        )
        archived_id = metadata.get("id")
        assert isinstance(archived_id, str) and ROADMAP_ID.match(archived_id), (
            f"Archived roadmap id should be a Roadmap ID ({ROADMAP_ID_DESCRIPTION}): {metadata}"
        )
        assert "created_at" not in metadata, (
            f"Archived roadmap metadata should not preserve active created_at: {metadata}"
        )
        for field in ("deps", "parallels"):
            values = metadata.get(field)
            assert isinstance(values, list) and all(
                isinstance(value, str) and ROADMAP_ID.match(value) for value in values
            ), (
                f"Archived roadmap metadata {field} should be an array of Roadmap IDs "
                f"({ROADMAP_ID_DESCRIPTION}): {metadata}"
            )
        assert metadata.get("agent"), f"Archived metadata should include agent: {metadata}"
        assert metadata.get("session_id"), f"Archived metadata should include session_id: {metadata}"
        assert body, "Archived roadmap entry body should explain why the item left Roadmap"


def _roadmap_note(lines: list[str]) -> str:
    current_section: str | None = None
    note_lines: list[str] = []
    for line in lines:
        if line.startswith("## "):
            if current_section == "Roadmap":
                break
            current_section = line[3:].strip()
            continue
        if current_section != "Roadmap":
            continue
        if _is_entry_heading(line, "Roadmap"):
            break
        note_lines.append(line)
    return "\n".join(note_lines).strip()


def _entries(lines: list[str], section: str) -> list[tuple[str, dict[str, object], str]]:
    entries: list[tuple[str, dict[str, object], str]] = []
    current_section: str | None = None
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("## "):
            current_section = line[3:].strip()
            index += 1
            continue
        if current_section != section or not _is_entry_heading(line, section):
            index += 1
            continue
        heading = line

        cursor = index + 1
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        metadata = _read_jsonl_metadata(lines, index, section)
        if cursor < len(lines) and lines[cursor].strip() == "```jsonl":
            cursor += 3
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1

        body_lines: list[str] = []
        while cursor < len(lines):
            if lines[cursor].startswith("## ") or _is_entry_heading(lines[cursor], section):
                break
            body_lines.append(lines[cursor])
            cursor += 1
        entries.append((heading, metadata, "\n".join(body_lines).strip()))
        index = cursor
    return entries


def _is_entry_heading(line: str, section: str) -> bool:
    if section == "Roadmap":
        return bool(ROADMAP_ENTRY.match(line))
    return bool(DATED_ENTRY.match(line))


def _read_jsonl_metadata(lines: list[str], heading_index: int, section: str) -> dict[str, object]:
    cursor = heading_index + 1
    while cursor < len(lines) and not lines[cursor].strip():
        cursor += 1

    assert cursor < len(lines), f"{section} entry is missing jsonl metadata block"
    assert lines[cursor].strip() == "```jsonl", (
        f"{section} entry metadata must start with a jsonl fence after: {lines[heading_index]}"
    )
    assert cursor + 2 < len(lines), f"{section} entry has an incomplete jsonl metadata block"
    assert lines[cursor + 2].strip() == "```", f"{section} entry metadata fence is not closed"

    raw_json = lines[cursor + 1].strip()
    assert raw_json.startswith("{") and raw_json.endswith("}"), (
        f"{section} metadata should be one single-line JSON object: {raw_json}"
    )
    try:
        loaded = json.loads(raw_json)
    except json.JSONDecodeError as error:
        raise AssertionError(f"{section} metadata is not valid JSON: {raw_json}") from error
    assert isinstance(loaded, dict), f"{section} metadata should decode to an object: {raw_json}"
    return loaded


def assert_noisy_taskmd_discovered(result: CommandResult) -> None:
    result.assert_success()
    assert "noisy:tmd" in result.stdout, "Codex prompt input did not include noisy:tmd"


def assert_skill_symlink_wired(workspace: Path) -> None:
    skill_link = workspace / ".codex" / "skills" / "noisy:tmd"
    assert skill_link.is_symlink(), f"Expected noisy:tmd to be a symlink: {skill_link}"
    assert skill_link.resolve() == TASKMD_SKILL_DIR.resolve(), (
        f"Expected noisy:tmd to point at live skill {TASKMD_SKILL_DIR}, got {skill_link.resolve()}"
    )


def assert_gemini_taskmd_wired(workspace: Path) -> None:
    skill_link = workspace / ".gemini" / "skills" / "tmd"
    assert skill_link.is_symlink(), f"Expected tmd to be a symlink: {skill_link}"
    assert skill_link.resolve() == TASKMD_SKILL_DIR.resolve(), (
        f"Expected tmd to point at live skill {TASKMD_SKILL_DIR}, got {skill_link.resolve()}"
    )

    command_link = workspace / ".gemini" / "commands" / "noisy" / "tmd.toml"
    assert command_link.is_symlink(), f"Expected /noisy:tmd command to be a symlink: {command_link}"
    assert command_link.resolve() == GEMINI_TASKMD_COMMAND.resolve(), (
        f"Expected Gemini command to point at {GEMINI_TASKMD_COMMAND}, got {command_link.resolve()}"
    )


def assert_gemini_taskmd_discovered(result: CommandResult) -> None:
    result.assert_success()
    assert re.search(r"^tmd\s+\[Enabled\]", result.stdout, re.MULTILINE), (
        "Gemini skills list did not include tmd as an enabled skill"
    )
    assert not re.search(r"^noisy:tmd\s+\[", result.stdout, re.MULTILINE), (
        "Gemini should discover the skill as tmd; noisy:tmd is the custom command name"
    )


def cleanup_runs(runs: Iterable[TestRun], *, test_failed: bool) -> None:
    if should_keep_runs(test_failed):
        return
    for run in runs:
        run.cleanup()
