# Claude Monitor — Design

Date: 2026-10-14
Status: Draft for user review

## 1. Purpose

A background monitor for Claude Code terminal sessions on Windows. When a session's
closing message tells the user to `/clear` (and usually to read a handoff file), the
monitor performs those steps automatically: it sends `/clear`, then tells the fresh
session to read the handoff.

### Scope

- Windows 11, Claude Code **terminal CLI** only (not the VS Code extension or desktop app).
- Sessions started by plain `claude` and by `claude-kevin`
  (`~/.local/bin/claude-kevin.cmd`, which runs `claude --settings '{"enabledPlugins":{"chrome-devtools-mcp@claude-plugins-official":true}}'`).
- Multiple concurrent sessions.
- Fully automatic after the session is idle. No per-action confirmation.

### Out of scope

- `/compact` prompts (e.g. kevin's `/compact` between domains).
- VS Code / desktop surfaces.
- Any session not registered by the hook.

## 2. Chosen approach: out-of-process daemon (Option A)

Rejected: PTY wrapper (B; kept as fallback if the injection spike fails) and
focus + SendKeys (C; steals focus, wrong-window risk).

Implementation: C# .NET (P/Invoke for console APIs). A long-running daemon plus a
short-lived `inject.exe` helper.

## 3. Components

### 3.1 Registration hook

- A `SessionStart` hook in `~/.claude/settings.json` (user settings, so it is inherited by
  `claude` and `claude-kevin` alike — to be confirmed in the spike).
- On each start it writes `%LOCALAPPDATA%\ClaudeMonitor\sessions\<session_id>.json`:
  `session_id`, `transcript_path`, `cwd`, `source` (startup/resume/clear), `claude_pid`, `started_at`.
- `claude_pid` is found by walking the hook's parent chain to the Claude process.
  `cmd.exe` from `claude-kevin.cmd` shares the same console, so the PID of either works for attach.
- Script: Node, at `Projects\claude-monitor\hook\register.js` (not under `~/.claude/hooks`, which is a globally ignored path).
- **`~/.claude/settings.json` edit: approved by the user (2026-10-14), to happen as the spike's first task**, together with a minimal working `register.js`, so settings.json never references a missing file. Back up settings.json first. Add as a second entry in the existing `SessionStart` array; do not alter the existing `context-resume.js` hook.
- **Risk:** settings.json has `"allowManagedHooksOnly": true`, which may block user-level hooks. The spike must test whether the hook fires. If blocked: stop and report to the user; do NOT change the flag.

### 3.2 Detector

Tails each registered transcript (`~/.claude/projects/<sanitized-cwd>/<session_id>.jsonl`).
A session triggers when ALL of the following hold:

1. The latest entry is an assistant message that ended its turn.
2. Its text contains an imperative `/clear` ("run /clear", "`/clear` before the next task"),
   outside code fences and block quotes.
3. Idle: no tool call awaiting a result or a permission/question answer, and the transcript
   has been quiet for N seconds (configurable, default 5).
4. Its message uuid has not been acted on before.

Handoff path resolution, in order:

1. A handoff path named in the same message.
2. A file in `<cwd>/.claude/handoff/` newer than the session start.
3. None. Send `/clear` only (the default for kevin end-of-run prompts).

### 3.3 Injector (`inject.exe <claudePid> <text> [--enter]`)

- Separate short-lived process, because `AttachConsole` is process-global.
- `AttachConsole(pid)` then `WriteConsoleInputW` key events per character.
- Enter is sent as its own event after a short delay, so Claude's paste heuristic does not
  turn it into a newline.

### 3.4 Orchestrator sequence

1. Detector fires for session S.
2. Inject `/clear` + Enter.
3. Wait for the hook to register a new session for the same PID with `source=clear`
   (timeout configurable, default 20s). This confirms the clear.
4. If a handoff path was resolved: inject `Read <path> and follow its instructions` + Enter.
5. On timeout: log, do not send step 4, notify the user.

## 4. Safety

- **Abandon on user activity:** if the transcript changes between detection and injection, abort.
- **Registered, live sessions only:** PID must be alive and the transcript must match the registration.
- **Rate limits:** one action per message uuid; 60s cooldown per session; max 3 actions per 10 minutes.
- **Controls:** dry-run mode (default on first launch), pause file / tray toggle.
- **Logging:** JSONL decision log; every action or skip is recorded with its reason.
- **Known residual risk:** Claude can discuss `/clear` in ordinary conversation. Mitigated by the
  idle, end-of-turn and code-fence checks, but not eliminated. An optional strict mode (require a
  distinctive marker line) is deferred unless false positives appear.

## 5. Spike (first task, before building)

Answer, with a throwaway probe:

1. Does `WriteConsoleInput` reach Claude running inside Windows Terminal (and plain conhost)?
2. Does the slash-command menu swallow Enter after `/clear`?
3. Does the paste heuristic affect typed text or Enter?
4. Do hooks from user settings and from `claude-kevin`'s `--settings` both fire?
5. Does `/clear` produce a new session id and transcript, and does `SessionStart` fire with `source=clear`?

If 1 fails, fall back to Option B (PTY wrapper) and revise this spec.

## 6. Testing

- Detector: unit tests over transcript fixtures, including false-positive cases
  (quoted `/clear`, code fences, mid-turn text, pending tool call).
- Injector: against a dummy echo console app first, then end-to-end with a real `claude`
  in a scratch folder.
- No databases, queues or other services, so no Docker infrastructure is needed.

## 7. Open items

- Idle quiet-period default (5s) and cooldown values to be tuned during end-to-end testing.
- Exact wording of the injected read-handoff instruction may be adjusted after the spike.
