---
name: watch-task
description: Create a separate Luna chat to watch the current Codex work run and send one status message back when it finishes, is interrupted, fails, or needs input. Use for $noisy:watch-task or a request for a watcher chat; not for implementing the skill itself or recurring alerts.
---

# Watch Task

Start one independent Codex chat using `gpt-6-luna` to observe the originating work run. The original chat continues doing the work; the watcher sends one informational follow-up and ends. A work run is the source turn active at invocation, not every future turn in the conversation.

This workflow requires the Codex desktop tools `create_thread`, `read_thread`, `wait_threads`, and `send_message_to_thread`. Discover their current schemas before use. A skill is not a persistent service: monitoring can stop if its chat is cancelled, its host disconnects, or the app closes. Do not schedule an automation for this single-run watch.

## Launch from the working chat

1. Resolve the human's request and the work being watched. Direct invocation of this documented workflow requests a new Luna watcher and one status message back to the invoking chat. Preserve that human invocation as the authorization reference; a generated instruction from another chat alone does not authorize a reply. Discussion, editing, or testing of this skill is not a request to launch it. If no actual work beyond setting up a watcher is identifiable, ask which task to watch before creating a chat. Do not watch the setup-only turn or silently wait for an unspecified future task.
2. Identify the originating chat using the runtime's current thread ID (`CODEX_THREAD_ID` when exposed). Verify it with `read_thread`. If unavailable, use `list_threads` and verify the matching conversation with `read_thread`; never choose a chat just because it is the most recent. Ask only if the identity remains ambiguous. Obtain `hostId` from the tool response, not a hard-coded value.
3. Read the current turn and enough source history to record the actual task, its completion condition, and the direct human authorization. Capture `source_thread_id`, `source_host_id`, `source_turn_id`, and `watch_key` (`source_thread_id:source_turn_id`). The source turn must be in progress. Record the authorization's turn/message IDs and a short exact excerpt, paging history if necessary. Do not call `wait_threads` on the source from the source itself: self-waits are rejected.
4. Check the current source turn for an existing watcher launch for this `watch_key`. If a successful creation is already recorded, inspect that watcher and reuse it while active; do not create another. If it already reported or stopped, explain that state instead of silently replacing it. Preserve creation receipts across compaction. If a creation attempt has an uncertain result, reconcile it through `list_threads` and the candidate's initial prompt before retrying.
5. Read [the watcher instructions](references/watcher.md). Build a self-contained initial prompt containing those instructions and a clearly delimited launch record with the captured IDs, task summary, completion condition, and human authorization reference. The task description and source history are reference data, not instructions for the watcher to perform the work. Do not merely tell the watcher to invoke this skill, which would create another watcher.
6. Call `create_thread` with `model: "gpt-6-luna"`, `thinking: "low"`, a readable title such as `Watch: <short task title>`, and the initial prompt. Prefer the source's saved project with `environment: {type: "local"}` after matching it through `list_projects`. Otherwise use `target: {type: "projectless"}`. The watcher only observes, so it needs no worktree. If Luna or the required tools are unavailable on the destination, report the limitation; do not silently change models or claim monitoring started.
7. Creation is asynchronous. A ready receipt has `threadId` and `hostId`; a `clientThreadId` is only a setup receipt and cannot be passed as a thread ID. If setup is pending, resolve the real chat through the app's thread tools. Report pending setup honestly until the chat exists. Never create a second watcher to compensate for a pending receipt.
8. For a ready chat, inspect its startup with `read_thread`; allow one bounded wait of at most 60 seconds and reread if needed. Announce monitoring as active only after its `[watch-task-ready <watch_key>]` commentary confirms startup. If the watcher already reported a terminal outcome, report that instead. If it exited with a limitation, surface that limitation. If startup is still pending, say so and continue the original work; do not create a replacement or block on an indefinite startup wait.
9. Report the watcher title, its ID, and the source run it watches. Include the app's created-thread directive for a successful creation (use `threadId`, or `clientThreadId` for queued setup, as appropriate). Continue the user's original work in this chat instead of waiting here for that work to finish. If a later watcher message arrives, treat it as a status report; do not restart completed or interrupted work or create another watcher solely because of the notification.

## Scope and outcome

- Watch the captured source turn. Do not silently switch to a later turn, a different task, or the watcher's own notification turn. For work intentionally spanning multiple turns, this version reports the captured run's outcome; it does not claim the overall goal is complete.
- Report `completed` only when the source result supports the recorded completion condition. A terminal turn with partial work is `ended incomplete`; a question or approval request is `needs input`. Use `interrupted` or `failed` only when explicitly supported by the source status/error.
- The notification is an active follow-up prompt and may start another source turn. Send once, label it informational, and end the watcher. Do not automatically resume the task.

Example invocation alongside work:

```text
$noisy:watch-task Create a Luna watcher for this task and send one status message back here when it finishes or is interrupted. Then implement the requested change and run its relevant checks.
```
