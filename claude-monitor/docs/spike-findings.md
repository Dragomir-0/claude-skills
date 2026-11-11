# Spike findings (Task 1, 2026-10-14)

## How to run
- Build: `dotnet publish src/ClaudeMonitor.Inject -c Release -o artifacts` then `dotnet publish src/ClaudeMonitor -c Release -o artifacts`.
- Dry-run (default, logs only): `artifacts\ClaudeMonitor.exe`. Inject for real: add `--live`. Other flags: `--quiet <sec>` (default 5), `--confirm-timeout <sec>` (20), `--data <dir>`, `--inject <path>`.
- Switching dry-run to --live: delete `acted.txt` first (dry-run marks messages acted, as do paused/rate-limited skips). Named handoff files must live in a `.claude/handoff` folder.
- Data dir: `%LOCALAPPDATA%\ClaudeMonitor`. Decision log `decisions.jsonl`; acted set `acted.txt`; hook registrations `sessions\*.json`.
- Autostart: Startup-folder shortcut `ClaudeMonitor.lnk` runs `artifactsClaudeMonitor.exe --live` minimized at logon (remove the .lnk to disable; a second daemon on the same data dir exits immediately (single-instance guard)).
- Pause: create the file `%LOCALAPPDATA%\ClaudeMonitor\PAUSE`; delete it to resume.
- Hook install: `node hook/install-hook.js C:/Users/Jason_Weiss/.claude/settings.json`. Uninstall: `node hook/install-hook.js --remove C:/Users/Jason_Weiss/.claude/settings.json`. In a Git Bash `!` prompt use forward slashes (backslashes are stripped). A timestamped `.bak-` backup of settings is written on each run.
- Hook verified (2026-10-14): fires for `claude` and `claude-kevin` (`claude_pid` is the real claude.exe, not the .cmd wrapper) and re-registers on `/clear` with `source=clear`. Test `/clear` on a session with at least one prompt; an empty session keeps its id.
- Known gap (Review Focus 3): text typed in the prompt box but not yet submitted is invisible to the monitor and would be mangled by the injection. Not fixable; only a submitted message (transcript change) aborts the action.
- Scratch claude must be launched with `CLAUDE*` env stripped (launch-clean.ps1), otherwise it writes no transcript.

## Environment
- `claude` resolves to `C:\Users\Jason_Weiss\.local\bin\claude.exe` (native exe, not node-hosted). Version seen: 2.1.299.
- Terminal host: Windows Terminal is the default terminal (OpenConsole embedding); the claude.exe process owns a `conhost.exe` child (`conhost.exe 0x4`).
- PID that worked for `AttachConsole`: the **claude.exe** process itself (EchoConsole probe: the exe PID also worked).

## Spec §5 answers
1. **Windows Terminal / conhost reachable?** YES. `AttachConsole(claude.exe pid)` + `WriteConsoleInputW` into `CONIN$` typed into a Windows Terminal-hosted Claude session. Gate passed; Option B (PTY wrapper) not needed.
2. **`/clear` via the slash menu?** YES. Injecting `/clear` + Enter executed it. A new transcript file with a new session id appeared, and the next injected prompt (`CLEARED`) landed in the new transcript.
3. **Enter swallowed as newline?** NO. Settings that worked: `enterDelayMs = 200`, `charDelayMs = 0` (the defaults in `inject.exe`). No retry needed.

## Probe 1 (EchoConsole)
`inject <pid> hi --enter` logged `char=104`, `char=105`, `Enter char=13`. (Key shows `None` for the characters, as the plan predicted.)

## Gotchas
- **Env inheritance:** a `claude` started from inside a Claude Code tool call inherits `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDECODE`, `CLAUDE_PID`. That child answered prompts but wrote NO transcript and NO `~/.claude/sessions/<pid>.json`. All spike/verification launches must strip every `CLAUDE*` env var (`scratchpad/launch-clean.ps1` does this). A real user terminal is not affected.
- A freshly started session's transcript is already ~250 KB (attachments/skill listings), so `SessionTail` baselining by offset (not by parsing) is the right design.

## Extra finding: native session registry
Claude itself maintains `~/.claude/sessions/<claude pid>.json`:
`{pid, sessionId, cwd, startedAt, procStart, version, kind, entrypoint, name, status: idle|busy, updatedAt, ...}`.
- Created at startup, `status` flips `idle`/`busy`, and **`sessionId` is updated in place after `/clear`** (verified: `59a70498...` → `0c1226ca...` on the same PID 43064).
- This gives a hook-free registry and an authoritative idle signal. It is a fallback if the `SessionStart` hook is blocked by `allowManagedHooksOnly` (see Task 2). Transcript path is derivable: `~/.claude/projects/<cwd with non-alphanumerics → '-'>/<sessionId>.jsonl`.
- Sibling `*.key` files in that folder are credential-pattern files: never read them.

## End-to-end results (Task 8, 2026-10-14, scratch sessions only)
- Dry-run: PASS. Decision `dry-run: would /clear then read: ...\e2e.md`; session not cleared.
- Live: PASS. `inject /clear sent` then `inject read-handoff sent`; a NEW session transcript contains `Read "...e2e.md" and follow its instructions.` and the reply `HANDOFF-OK`. Repeated on a second fresh claude-kevin session: PASS.
- Pause: PASS. `skip paused`, no `/clear`, no new session. Delete the PAUSE file to resume.
- Baseline restart (Review Focus 2): PASS. A restarted daemon took no action on an old session whose last message was an unacted trigger.
- claude-kevin: PASS (hook registers the real claude.exe pid, not the .cmd wrapper).
- Typing guard (Review Focus 3): PASS. After the trigger, submitting `x` inside the 15s quiet window produced no action (message no longer last entry). With no `x`, the daemon acts exactly 15s after the reply.
- Operating note: the agent's auto-mode classifier blocks the agent from injecting into sessions or starting the `--live` daemon; the user ran those steps and typed triggers by hand.
