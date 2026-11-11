# claude-monitor

Optional add-on — not part of the skills pipeline and not a skill. A Windows background monitor
for Claude Code terminal sessions: when a session's closing message tells you to `/clear` (and
usually to read a handoff file), the monitor sends `/clear`, then tells the fresh session to read
the handoff.

Full design: [`docs/superpowers/specs/2026-10-14-claude-monitor-design.md`](docs/superpowers/specs/2026-10-14-claude-monitor-design.md).
Injection spike results: [`docs/spike-findings.md`](docs/spike-findings.md).

## Requirements

- Windows 11, Claude Code **terminal CLI** (not the VS Code extension or desktop app)
- .NET 10 SDK (to build) — `net10.0`
- Node on PATH for the `SessionStart` hook and its installer; Node 18+ to run the hook tests (they use `node:test`)

## Layout

| Path | What it is |
|---|---|
| `src/ClaudeMonitor.Core` | Detector, transcript parsing, session registry, orchestration |
| `src/ClaudeMonitor` | The daemon |
| `src/ClaudeMonitor.Inject` | Short-lived `inject.exe` helper that writes to the session's console |
| `hook/` | `register.js` (SessionStart hook) and `install-hook.js`, with tests |
| `tests/ClaudeMonitor.Core.Tests` | xUnit tests |
| `tools/spike` | Console-injection spike harness |
| `artifacts/` | Prebuilt daemon and `inject.exe` binaries |

## Build and test

```powershell
dotnet build ClaudeMonitor.sln
dotnet test ClaudeMonitor.sln
node --test hook/
```

## Install the hook

`hook/install-hook.js` adds a `SessionStart` entry to a Claude Code settings file; `--remove`
takes it out again. It edits the settings file you pass it in place, after writing a timestamped
`.bak-<yyyymmddhhmmss>` copy next to it.

```powershell
node hook/install-hook.js [--remove] <path-to-settings.json>
```

The hook writes `%LOCALAPPDATA%\ClaudeMonitor\sessions\<session_id>.json` for each session; the
daemon only acts on sessions registered that way.

## Notes

- `artifacts/` is a snapshot of build output, committed so the add-on works without a build.
  Rebuild it from `src/` if the source changes.
- `bin/` and `obj/` are gitignored.
