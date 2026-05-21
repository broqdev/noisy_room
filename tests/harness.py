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
TASKMD_SKILL_DIR = REPO_ROOT / "plugins" / "noisy" / "skills" / "taskmd"
TASKMD_RT_SKILL_DIR = REPO_ROOT / "plugins" / "noisy" / "skills" / "taskmd-rt"
GEMINI_TASKMD_COMMAND = REPO_ROOT / ".gemini" / "commands" / "noisy" / "taskmd.toml"
VERIFIER_SCHEMA = TESTS_DIR / "schemas" / "verifier-result.schema.json"

TASK_DOC_SECTIONS = ["Goal", "Knowledge", "Progress", "Worklog", "Archived", "TODO"]
DATED_ENTRY = re.compile(r"^### \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC - .+")
TODO_RATIONALE = "Rationale:"
TODO_TASK = "Task:"


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


@dataclass(frozen=True)
class GeminiExecutionProfile:
    name: str
    flags: tuple[str, ...]
    timeout_seconds: int = 600

    def command(self, prompt: str) -> list[str]:
        return [
            "gemini",
            "--prompt",
            prompt,
            "--output-format",
            "text",
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
- Progress says the task doc was created and implementation has not started, or an equivalent current-state statement.
- TODO contains a concrete next action that would advance the source brief's work.
- TODO does not tell the next agent to edit the source brief unless the source brief explicitly requested that.

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
        codex_version = ""
        gemini_version = ""
        if codex_path:
            version_result = subprocess.run(
                [codex_path, "--version"],
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
            codex_version = (version_result.stdout or version_result.stderr).strip()
        if gemini_path:
            version_result = subprocess.run(
                [gemini_path, "--version"],
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
            gemini_version = (version_result.stdout or version_result.stderr).strip()
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
            "taskmd_rt_skill_dir": str(TASKMD_RT_SKILL_DIR),
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
        skill_link = skill_root / "noisy:taskmd"
        skill_link.symlink_to(TASKMD_SKILL_DIR, target_is_directory=True)
        rt_skill_link = skill_root / "noisy:taskmd-rt"
        rt_skill_link.symlink_to(TASKMD_RT_SKILL_DIR, target_is_directory=True)

    def _wire_gemini_skill(self) -> None:
        skill_root = self.workspace / ".gemini" / "skills"
        skill_root.mkdir(parents=True, exist_ok=True)
        skill_link = skill_root / "taskmd"
        skill_link.symlink_to(TASKMD_SKILL_DIR, target_is_directory=True)

        command_root = self.workspace / ".gemini" / "commands" / "noisy"
        command_root.mkdir(parents=True, exist_ok=True)
        command_link = command_root / "taskmd.toml"
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


def create_test_run(name: str) -> TestRun:
    if not TASKMD_SKILL_DIR.exists():
        raise AssertionError(f"Taskmd skill directory does not exist: {TASKMD_SKILL_DIR}")
    if not TASKMD_RT_SKILL_DIR.exists():
        raise AssertionError(f"Taskmd RT skill directory does not exist: {TASKMD_RT_SKILL_DIR}")
    if not GEMINI_TASKMD_COMMAND.exists():
        raise AssertionError(f"Gemini taskmd command does not exist: {GEMINI_TASKMD_COMMAND}")
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


def validate_single_new_task_doc(workspace: Path, *, source_name: str) -> Path:
    task_doc = find_single_task_doc(workspace)
    validate_new_task_doc_contract(task_doc, source_name=source_name)
    return task_doc


def metadata_records(task_doc: Path, section: str) -> list[dict[str, object]]:
    assert section in TASK_DOC_SECTIONS, f"Unknown task doc section: {section}"
    return _collect_metadata(task_doc.read_text(encoding="utf-8").splitlines())[section]


def validate_new_task_doc_contract(task_doc: Path, *, source_name: str) -> None:
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
    todo = section_text["TODO"].lower()
    assert source_name in section_text["Knowledge"], f"Knowledge should list {source_name!r}"
    assert "reference" in knowledge, "Knowledge should mark source docs as reference material"
    assert ("do not" in knowledge or "must not" in knowledge) and (
        "modify" in knowledge
        or "modified" in knowledge
        or "modification" in knowledge
        or "edit" in knowledge
    ), "Knowledge should say the source/reference docs must not be modified"
    assert not re.search(rf"\b(edit|modify|update|change)\b[^\n]*\b{re.escape(source_name.lower())}\b", todo), (
        f"TODO should not ask future work to edit {source_name!r}"
    )

    metadata_by_section = _collect_metadata(lines)
    worklog_metadata = metadata_by_section["Worklog"]
    assert worklog_metadata, "Creation should add at least one Worklog record"
    assert all(record.get("trigger") == "revisit" for record in worklog_metadata), (
        "Creation Worklog metadata should only include trigger='revisit'"
    )
    for record in worklog_metadata:
        assert record.get("agent") == "codex-cli", f"Unexpected Worklog agent: {record}"
        assert record.get("session_id"), f"Worklog metadata should include session_id: {record}"
        assert record.get("worklog_id"), f"Worklog metadata should include worklog_id: {record}"

    todo_metadata = metadata_by_section["TODO"]
    assert todo_metadata, "Creation should add at least one TODO record"
    for record in todo_metadata:
        assert record.get("agent") == "codex-cli", f"Unexpected TODO agent: {record}"
        assert record.get("session_id"), f"TODO metadata should include session_id: {record}"
    assert_todo_entries_have_rationale_and_task(lines)


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
        if current_section not in {"Worklog", "TODO", "Archived"}:
            continue
        if DATED_ENTRY.match(line):
            metadata[current_section].append(_read_jsonl_metadata(lines, index, current_section))
    return metadata


def assert_todo_entries_have_rationale_and_task(lines: list[str]) -> None:
    bodies = _entry_bodies(lines, "TODO")
    assert bodies, "TODO should contain at least one entry"
    for body in bodies:
        body_lines = body.splitlines()
        rationale_lines = [
            index for index, line in enumerate(body_lines) if line.startswith(TODO_RATIONALE)
        ]
        task_lines = [
            index for index, line in enumerate(body_lines) if line.startswith(TODO_TASK)
        ]
        assert len(rationale_lines) == 1, (
            "TODO entry body should include exactly one 'Rationale:' line"
        )
        assert len(task_lines) == 1, "TODO entry body should include exactly one 'Task:' line"
        rationale_index = rationale_lines[0]
        task_index = task_lines[0]
        assert rationale_index < task_index, "TODO entry body should put 'Rationale:' before 'Task:'"
        preface = "\n".join(body_lines[:rationale_index]).strip()
        assert not preface, "TODO entry body should start with 'Rationale:'"
        rationale = "\n".join(
            [
                body_lines[rationale_index][len(TODO_RATIONALE):],
                *body_lines[rationale_index + 1:task_index],
            ]
        ).strip()
        task = "\n".join(
            [body_lines[task_index][len(TODO_TASK):], *body_lines[task_index + 1:]]
        ).strip()
        assert rationale, "TODO entry Rationale should be non-empty"
        assert task, "TODO entry Task should be non-empty"


def _entry_bodies(lines: list[str], section: str) -> list[str]:
    bodies: list[str] = []
    current_section: str | None = None
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("## "):
            current_section = line[3:].strip()
            index += 1
            continue
        if current_section != section or not DATED_ENTRY.match(line):
            index += 1
            continue

        cursor = index + 1
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        if cursor < len(lines) and lines[cursor].strip() == "```jsonl":
            cursor += 3
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1

        body_lines: list[str] = []
        while cursor < len(lines):
            if lines[cursor].startswith("## ") or DATED_ENTRY.match(lines[cursor]):
                break
            body_lines.append(lines[cursor])
            cursor += 1
        bodies.append("\n".join(body_lines).strip())
        index = cursor
    return bodies


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
    assert "noisy:taskmd" in result.stdout, "Codex prompt input did not include noisy:taskmd"


def assert_skill_symlink_wired(workspace: Path) -> None:
    skill_link = workspace / ".codex" / "skills" / "noisy:taskmd"
    assert skill_link.is_symlink(), f"Expected noisy:taskmd to be a symlink: {skill_link}"
    assert skill_link.resolve() == TASKMD_SKILL_DIR.resolve(), (
        f"Expected noisy:taskmd to point at live skill {TASKMD_SKILL_DIR}, got {skill_link.resolve()}"
    )


def assert_taskmd_rt_skill_wired(workspace: Path) -> None:
    skill_link = workspace / ".codex" / "skills" / "noisy:taskmd-rt"
    assert skill_link.is_symlink(), f"Expected noisy:taskmd-rt to be a symlink: {skill_link}"
    assert skill_link.resolve() == TASKMD_RT_SKILL_DIR.resolve(), (
        f"Expected noisy:taskmd-rt to point at live skill {TASKMD_RT_SKILL_DIR}, got {skill_link.resolve()}"
    )


def assert_taskmd_rt_discovered(result: CommandResult) -> None:
    result.assert_success()
    assert "noisy:taskmd-rt" in result.stdout, "Codex prompt input did not include noisy:taskmd-rt"


def assert_gemini_taskmd_wired(workspace: Path) -> None:
    skill_link = workspace / ".gemini" / "skills" / "taskmd"
    assert skill_link.is_symlink(), f"Expected taskmd to be a symlink: {skill_link}"
    assert skill_link.resolve() == TASKMD_SKILL_DIR.resolve(), (
        f"Expected taskmd to point at live skill {TASKMD_SKILL_DIR}, got {skill_link.resolve()}"
    )

    command_link = workspace / ".gemini" / "commands" / "noisy" / "taskmd.toml"
    assert command_link.is_symlink(), f"Expected /noisy:taskmd command to be a symlink: {command_link}"
    assert command_link.resolve() == GEMINI_TASKMD_COMMAND.resolve(), (
        f"Expected Gemini command to point at {GEMINI_TASKMD_COMMAND}, got {command_link.resolve()}"
    )


def assert_gemini_taskmd_discovered(result: CommandResult) -> None:
    result.assert_success()
    assert re.search(r"^taskmd\s+\[Enabled\]", result.stdout, re.MULTILINE), (
        "Gemini skills list did not include taskmd as an enabled skill"
    )
    assert not re.search(r"^noisy:taskmd\s+\[", result.stdout, re.MULTILINE), (
        "Gemini should discover the skill as taskmd; noisy:taskmd is the custom command name"
    )


def cleanup_runs(runs: Iterable[TestRun], *, test_failed: bool) -> None:
    if should_keep_runs(test_failed):
        return
    for run in runs:
        run.cleanup()
