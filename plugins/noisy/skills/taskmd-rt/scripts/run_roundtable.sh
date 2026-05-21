#!/usr/bin/env bash
set -euo pipefail

rounds=1
workspace="."
task_doc_arg=""
codex_bin="${CODEX_BIN:-codex}"
gemini_bin="${GEMINI_BIN:-gemini}"
dry_run=0
user_prompt_parts=()

main() {
  parse_args "$@"

  if ! [[ "$rounds" =~ ^[0-9]+$ ]]; then
    echo "--r must be a non-negative integer." >&2
    exit 2
  fi

  workspace="$(cd "$workspace" && pwd -P)"

  if [ -z "$task_doc_arg" ] && [ "${#user_prompt_parts[@]}" -gt 0 ] && looks_like_task_doc "${user_prompt_parts[0]}"; then
    task_doc_arg="${user_prompt_parts[0]}"
    user_prompt_parts=("${user_prompt_parts[@]:1}")
  fi

  user_prompt="${user_prompt_parts[*]}"
  if [ -z "$user_prompt" ]; then
    echo "User prompt is required." >&2
    exit 2
  fi

  task_doc=""
  if [ -n "$task_doc_arg" ]; then
    task_doc="$(ensure_task_doc "$task_doc_arg")"
  else
    if ! task_doc="$(find_single_task_doc)"; then
      exit 2
    fi
  fi

  if [ -z "$task_doc" ]; then
    bootstrap_prompt="$(build_taskmd_prompt "codex-cli" "" "$user_prompt")"
    if [ "$dry_run" -eq 1 ]; then
      printf 'workspace=%s\n' "$workspace"
      printf 'rounds=%s\n' "$rounds"
      printf 'continue_after_bootstrap=true\n'
      print_plan "bootstrap" "codex-cli" "$bootstrap_prompt"
      exit 0
    fi

    run_agent "codex-cli" "$bootstrap_prompt"
    if ! task_doc="$(find_single_task_doc)"; then
      exit 2
    fi
    if [ -z "$task_doc" ]; then
      echo "Bootstrap finished but no task doc was found." >&2
      exit 1
    fi
    verify_worklog_advanced "$task_doc" "codex-cli" "0" "" "bootstrap"
  fi

  if [ "$dry_run" -eq 1 ]; then
    printf 'workspace=%s\n' "$workspace"
    printf 'rounds=%s\n' "$rounds"
    printf 'task_doc=%s\n' "$(relative_to_workspace "$task_doc")"
  fi

  call_count=$((rounds * 2))
  current_agent="$(latest_worklog_agent "$task_doc")"

  for ((index = 1; index <= call_count; index++)); do
    next_agent="$(opposite_agent "$current_agent")"
    prompt="$(build_taskmd_prompt "$next_agent" "$task_doc" "$user_prompt")"

    if [ "$dry_run" -eq 1 ]; then
      print_plan "call_$index" "$next_agent" "$prompt"
      current_agent="$next_agent"
      continue
    fi

    before_worklog_count="$(worklog_metadata_count "$task_doc")"
    before_worklog_metadata="$(latest_worklog_metadata "$task_doc")"
    run_agent "$next_agent" "$prompt"
    verify_worklog_advanced \
      "$task_doc" \
      "$next_agent" \
      "$before_worklog_count" \
      "$before_worklog_metadata" \
      "call $index"
    current_agent="$(latest_worklog_agent "$task_doc")"
  done

  if [ "$dry_run" -eq 0 ]; then
    printf 'Completed %s roundtable calls for %s.\n' "$call_count" "$(relative_to_workspace "$task_doc")"
  fi
}

usage() {
  cat <<'EOF'
Usage: run_roundtable.sh [--workspace PATH] [--task-doc PATH] [--r N] [--dry-run] -- <user prompt>

Runs noisy:taskmd as a Codex/Gemini roundtable.
One round means two interleaved CLI calls after a task doc exists.
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --workspace)
        workspace="${2:?--workspace requires a path}"
        shift 2
        ;;
      --task-doc)
        task_doc_arg="${2:?--task-doc requires a path}"
        shift 2
        ;;
      --r)
        rounds="${2:?--r requires a non-negative integer}"
        shift 2
        ;;
      --codex-bin)
        codex_bin="${2:?--codex-bin requires a command}"
        shift 2
        ;;
      --gemini-bin)
        gemini_bin="${2:?--gemini-bin requires a command}"
        shift 2
        ;;
      --dry-run)
        dry_run=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        echo "Unsupported option: $1" >&2
        usage >&2
        exit 2
        ;;
      *)
        break
        ;;
    esac
  done
  user_prompt_parts=("$@")
}

looks_like_task_doc() {
  case "$1" in
    .noisy_room/tasks/*.md|*/.noisy_room/tasks/*.md) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_task_doc() {
  local raw="$1"
  local absolute
  case "$raw" in
    /*) absolute="$raw" ;;
    *) absolute="$workspace/$raw" ;;
  esac

  if [ ! -f "$absolute" ]; then
    echo "Task doc does not exist: $raw" >&2
    exit 2
  fi
  case "$absolute" in
    "$workspace"/.noisy_room/tasks/*.md) ;;
    *) echo "Task doc must live under .noisy_room/tasks/: $raw" >&2; exit 2 ;;
  esac
  (cd "$(dirname "$absolute")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$absolute")")
}

find_single_task_doc() {
  local task_dir="$workspace/.noisy_room/tasks"
  [ -d "$task_dir" ] || return 0

  local docs=()
  while IFS= read -r path; do
    docs+=("$path")
  done < <(find "$task_dir" -maxdepth 1 -type f -name '*.md' | sort)

  if [ "${#docs[@]}" -eq 0 ]; then
    return 0
  fi
  if [ "${#docs[@]}" -gt 1 ]; then
    echo "Multiple task docs found. Pass --task-doc explicitly:" >&2
    printf '%s\n' "${docs[@]#$workspace/}" >&2
    return 2
  fi
  printf '%s\n' "${docs[0]}"
}

latest_worklog_agent() {
  local task_doc="$1"
  local metadata
  metadata="$(latest_worklog_metadata "$task_doc")"

  if [ -z "$metadata" ]; then
    echo "No Worklog metadata records found in $task_doc" >&2
    exit 2
  fi

  local agent
  agent="$(printf '%s\n' "$metadata" | sed -n 's/.*"agent"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -z "$agent" ]; then
    agent="$(printf '%s\n' "$metadata" | sed -n 's/.*"agent_cli"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi

  case "$agent" in
    codex-cli|gemini-cli) printf '%s\n' "$agent" ;;
    "") echo "Latest Worklog metadata must include agent." >&2; exit 2 ;;
    *) echo "Latest Worklog agent must be codex-cli or gemini-cli; found '$agent'." >&2; exit 2 ;;
  esac
}

latest_worklog_metadata() {
  local task_doc="$1"
  awk '
    /^## Worklog$/ { in_worklog = 1; next }
    in_worklog && /^## / { exit }
    in_worklog && /^\{.*\}$/ { latest = $0 }
    END { print latest }
  ' "$task_doc"
}

worklog_metadata_count() {
  local task_doc="$1"
  awk '
    /^## Worklog$/ { in_worklog = 1; next }
    in_worklog && /^## / { exit }
    in_worklog && /^\{.*\}$/ { count++ }
    END { print count + 0 }
  ' "$task_doc"
}

verify_worklog_advanced() {
  local task_doc="$1"
  local expected_agent="$2"
  local before_count="$3"
  local before_metadata="$4"
  local label="$5"
  local after_count
  local after_metadata
  local after_agent

  after_count="$(worklog_metadata_count "$task_doc")"
  after_metadata="$(latest_worklog_metadata "$task_doc")"

  if [ "$after_count" -le "$before_count" ]; then
    echo "Expected $label to append a new Worklog metadata record to $(relative_to_workspace "$task_doc")." >&2
    echo "Before Worklog records: $before_count; after Worklog records: $after_count." >&2
    exit 1
  fi

  if [ -z "$after_metadata" ]; then
    echo "Expected $label to leave a latest Worklog metadata record in $(relative_to_workspace "$task_doc")." >&2
    exit 1
  fi

  if [ -n "$before_metadata" ] && [ "$after_metadata" = "$before_metadata" ]; then
    echo "Expected $label to add new Worklog metadata, but the latest metadata did not change." >&2
    exit 1
  fi

  after_agent="$(printf '%s\n' "$after_metadata" | sed -n 's/.*"agent"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -z "$after_agent" ]; then
    after_agent="$(printf '%s\n' "$after_metadata" | sed -n 's/.*"agent_cli"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi

  if [ "$after_agent" != "$expected_agent" ]; then
    echo "Expected latest Worklog agent to be '$expected_agent' after $label, found '${after_agent:-missing}'." >&2
    exit 1
  fi
}

opposite_agent() {
  case "$1" in
    codex-cli) printf 'gemini-cli\n' ;;
    gemini-cli) printf 'codex-cli\n' ;;
    *) echo "Cannot route from unknown agent: $1" >&2; exit 2 ;;
  esac
}

relative_to_workspace() {
  local path="$1"
  printf '%s\n' "${path#$workspace/}"
}

build_taskmd_prompt() {
  local agent="$1"
  local task_doc="$2"
  local prompt="$3"
  local invocation

  if [ "$agent" = "codex-cli" ]; then
    invocation='$noisy:taskmd'
  else
    invocation='/noisy:taskmd'
  fi

  if [ -n "$task_doc" ]; then
    local task_doc_rel
    task_doc_rel="$(relative_to_workspace "$task_doc")"
    printf '%s %s %s\n\nTask doc path: %s\n\n' "$invocation" "$task_doc_rel" "$prompt" "$task_doc_rel"
  else
    printf '%s %s\n\nTask doc path: create or select one using noisy:taskmd rules.\n\n' "$invocation" "$prompt"
  fi

  cat <<EOF
Roundtable handoff:
- Run the noisy:taskmd workflow for this prompt.
- Before exiting, update the task doc Worklog.
- In Worklog/TODO/Archived metadata, write "agent": "$agent".
- Do not write legacy "agent_cli" metadata.
EOF
}

run_agent() {
  local agent="$1"
  local prompt="$2"

  printf '=== Running %s ===\n' "$agent"
  if [ "$agent" = "codex-cli" ]; then
    "$codex_bin" exec \
      -C "$workspace" \
      --color never \
      --skip-git-repo-check \
      --ephemeral \
      --dangerously-bypass-approvals-and-sandbox \
      "$prompt"
  else
    GEMINI_CLI_TRUST_WORKSPACE=true "$gemini_bin" \
      --prompt "$prompt" \
      --output-format text \
      --skip-trust \
      --approval-mode yolo
  fi
}

print_plan() {
  local label="$1"
  local agent="$2"
  local prompt="$3"

  printf '%s_agent=%s\n' "$label" "$agent"
  printf '%s_prompt<<EOF\n%s\nEOF\n' "$label" "$prompt"
}

main "$@"
