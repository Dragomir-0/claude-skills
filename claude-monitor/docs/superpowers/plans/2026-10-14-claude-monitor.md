# Claude Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, in the current session. Do NOT dispatch subagents (user's global rule). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows daemon that watches Claude Code terminal sessions and, when a session's closing message tells the user to `/clear` (usually plus a handoff to read), types `/clear` and then a read-handoff instruction into that session's console.

**Architecture:** A `SessionStart` hook (Node) registers each session (id, transcript path, cwd, Claude PID) in `%LOCALAPPDATA%\ClaudeMonitor\sessions`. A C# daemon tails each registered transcript, detects an idle end-of-turn message that imperatively asks for `/clear`, and drives a short-lived `inject.exe` that uses `AttachConsole` + `WriteConsoleInputW` to type into the session's console. Safety layer: dry-run default, pause file, rate limits, acted-uuid store, JSONL decision log.

**Tech Stack:** .NET 10 (SDK 10.0.301 installed), xunit, Node v25 (`node:test`) for the hook, Win32 P/Invoke.

**Spec:** `docs/superpowers/specs/2026-10-14-claude-monitor-design.md`

**Execution notes**
- `C:\Users\Jason_Weiss\Projects\claude-monitor` is not a git repo. Commit steps are omitted; commit only if the user asks.
- All paths below are relative to `C:\Users\Jason_Weiss\Projects\claude-monitor` unless absolute.
- No databases, queues or other services are involved, so no Docker infrastructure is needed (per global "Running applications" rule: nothing to create, nothing falls back to remote).
- Never name files `.env*`, `appsettings.*`, `config.json`, `*.local`, `credentials*` (global ignore list). Configuration is CLI flags only.
- Never read or write `~/.claude/hooks/`. The only globally-ignored file this plan touches is `~/.claude/settings.json`, approved by the user on 2026-10-14, only via Task 2's `install-hook.js` (backup first).
- Tasks 1 and 2 need a real interactive terminal session. If Claude shows a folder-trust prompt in the scratch folder, ask the user to accept it once.

## Global Constraints

- Platform: Windows 11, Claude Code terminal CLI only. Sessions started by `claude` and by `claude-kevin` (`C:\Users\Jason_Weiss\.local\bin\claude-kevin.cmd`).
- Fully automatic after idle; no per-action confirmation. Dry-run is the default on first launch (`--live` turns it off).
- Trigger: latest entry is an assistant message ending its turn (`stop_reason == "end_turn"`); text has an imperative `/clear` outside code fences and block quotes; no pending tool call / permission answer; transcript quiet for N seconds (default 5); message uuid not acted on before.
- Handoff resolution order: path named in the message, then newest `*.md` (not `LEDGER.md`) in `<cwd>/.claude/handoff/` newer than session start, else none (send `/clear` only).
- Sequence: inject `/clear`+Enter; wait for hook to register a new session on the same PID with `source=clear` (timeout default 20s); then inject `Read "<path>" and follow its instructions.`+Enter. On timeout: log, do not send the read line.
- Safety: abort if transcript length changed between detection and injection; registered live PIDs only; one action per message uuid; 60s cooldown per session PID; max 3 actions per 10 minutes; pause file `%LOCALAPPDATA%\ClaudeMonitor\PAUSE`; JSONL decision log.
- Hook must NOT change `allowManagedHooksOnly`. If the hook is blocked, stop and report.
- Out of scope: `/compact` prompts, VS Code/desktop surfaces, unregistered sessions.
- Data dir: `%LOCALAPPDATA%\ClaudeMonitor` (sessions\, acted.txt, decisions.jsonl, hook-errors.log, PAUSE).

## Review Focus

1. **Claude discussing `/clear` in ordinary conversation** ("`/clear` is a built-in command", a design list item "Type `/clear` and press Enter" mid-message): must not fire. Only the last paragraph is inspected; negations ("don't run /clear") skip. Tested in Task 4.
2. **Monitor restarted while a running session's last message is an old `/clear` request:** must not fire (baseline-to-end for sessions that started before the daemon). Tested in Task 3 and Task 8.
3. **User touched the session between detection and injection:** transcript length changed, so abort. Known gap, documented not fixable: text typed but not yet submitted in the input box is invisible to the monitor and would be mangled. Tested in Task 7.
4. **Dead or reused PIDs and two sessions in one cwd:** dead PID registrations are ignored; one registration per PID (latest wins). Tested in Task 6.
5. **Handoff paths with spaces, trailing punctuation, relative form, or a missing file; `/clear` that never confirms:** quoted in the read line; unresolved paths fall back; no read line sent on timeout. Tested in Tasks 5 and 7.

---

## File Structure

```
claude-monitor/
  ClaudeMonitor.sln
  hook/
    register.js            SessionStart hook: writes session registration
    register.test.js
    install-hook.js        idempotent add/remove of the hook entry in settings.json (with backup)
    install-hook.test.js
  src/
    ClaudeMonitor.Core/    pure logic, no Win32
      TranscriptEntry.cs   record + EntryKind
      TranscriptParser.cs  one JSONL line -> TranscriptEntry?
      SessionTail.cs       incremental transcript reader
      ClearPrompt.cs       "does this text imperatively ask for /clear"
      Detector.cs          idle/end-of-turn/pending-tool/quiet/ask decision
      HandoffResolver.cs
      RateLimiter.cs  ActedStore.cs  DecisionLog.cs
      SessionInfo.cs  SessionRegistry.cs
      Orchestrator.cs      IInjector + the /clear -> confirm -> read sequence
    ClaudeMonitor.Inject/  inject.exe <pid> <text> [--enter]  (Win32 console input)
    ClaudeMonitor/         daemon: wiring, polling loop, ProcessInjector
  tests/
    ClaudeMonitor.Core.Tests/  (Fx.cs test-data helper + one test file per Core unit)
  tools/spike/
    EchoConsole/           prints every key event it receives (spike only)
    scratch/               working dir for throwaway claude sessions
  docs/spike-findings.md   written in Task 1/2
```

---

### Task 1: Scaffold + injection spike (spec §5 questions 1-3)

Go/no-go gate: if injection into Windows Terminal does not work, STOP and report to the user. The spec falls back to Option B (PTY wrapper) and must be revised.

**Files:**
- Create: `ClaudeMonitor.sln`, `src/ClaudeMonitor.Core/`, `src/ClaudeMonitor.Inject/Program.cs`, `src/ClaudeMonitor/`, `tests/ClaudeMonitor.Core.Tests/`, `tools/spike/EchoConsole/Program.cs`, `docs/spike-findings.md`

**Interfaces:**
- Produces: `inject.exe <claudePid> <text> [--enter]` exit code 0 on success, non-zero on failure (message on stderr). Used by `ProcessInjector` in Task 8.

- [ ] **Step 1: Scaffold the solution**

Run (PowerShell, from `C:\Users\Jason_Weiss\Projects\claude-monitor`):
```powershell
dotnet new sln --format sln -n ClaudeMonitor
dotnet new classlib -n ClaudeMonitor.Core -o src/ClaudeMonitor.Core -f net10.0
dotnet new console -n ClaudeMonitor.Inject -o src/ClaudeMonitor.Inject -f net10.0
dotnet new console -n ClaudeMonitor -o src/ClaudeMonitor -f net10.0
dotnet new xunit -n ClaudeMonitor.Core.Tests -o tests/ClaudeMonitor.Core.Tests -f net10.0
dotnet new console -n EchoConsole -o tools/spike/EchoConsole -f net10.0
Remove-Item src/ClaudeMonitor.Core/Class1.cs
dotnet sln add src/ClaudeMonitor.Core src/ClaudeMonitor.Inject src/ClaudeMonitor tests/ClaudeMonitor.Core.Tests tools/spike/EchoConsole
dotnet add src/ClaudeMonitor reference src/ClaudeMonitor.Core
dotnet add tests/ClaudeMonitor.Core.Tests reference src/ClaudeMonitor.Core
New-Item -ItemType Directory -Force tools/spike/scratch | Out-Null
```
Edit `src/ClaudeMonitor.Inject/ClaudeMonitor.Inject.csproj`: inside the first `<PropertyGroup>` add `<AssemblyName>inject</AssemblyName>`.
Expected: all commands succeed.

- [ ] **Step 2: Write the echo target (logs every key event to a file)**

`tools/spike/EchoConsole/Program.cs`:
```csharp
var log = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "echo.log");
File.WriteAllText(log, $"ready pid={Environment.ProcessId}\n");
Console.WriteLine($"echo ready pid={Environment.ProcessId} log={log}; press Q to quit");
while (true)
{
    var k = Console.ReadKey(true);
    File.AppendAllText(log, $"key={k.Key} char={(int)k.KeyChar} mods={k.Modifiers}\n");
    if (k.Key == ConsoleKey.Q) break;
}
```

- [ ] **Step 3: Write inject.exe**

`src/ClaudeMonitor.Inject/Program.cs`:
```csharp
using System.Runtime.InteropServices;

if (args.Length < 2 || !uint.TryParse(args[0], out var pid))
{
    Console.Error.WriteLine("usage: inject <pid> <text> [--enter]");
    return 2;
}
var text = args[1];
var enter = args.Contains("--enter");
var charDelayMs = 0;
var enterDelayMs = 200;

NativeMethods.FreeConsole();
if (!NativeMethods.AttachConsole(pid))
{
    Console.Error.WriteLine($"AttachConsole({pid}) failed: {Marshal.GetLastWin32Error()}");
    return 3;
}
var h = NativeMethods.CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
if (h == new IntPtr(-1))
{
    Console.Error.WriteLine($"open CONIN$ failed: {Marshal.GetLastWin32Error()}");
    return 4;
}

var records = new List<NativeMethods.INPUT_RECORD>();
foreach (var c in text)
{
    records.Add(NativeMethods.Key(true, 0, 0, c));
    records.Add(NativeMethods.Key(false, 0, 0, c));
    if (charDelayMs > 0) { Flush(); Thread.Sleep(charDelayMs); }
}
Flush();
if (enter)
{
    Thread.Sleep(enterDelayMs);
    records.Add(NativeMethods.Key(true, 0x0D, 0x1C, '\r'));
    records.Add(NativeMethods.Key(false, 0x0D, 0x1C, '\r'));
    Flush();
}
return 0;

void Flush()
{
    if (records.Count == 0) return;
    var arr = records.ToArray();
    if (!NativeMethods.WriteConsoleInputW(h, arr, (uint)arr.Length, out var written) || written != arr.Length)
    {
        Console.Error.WriteLine($"WriteConsoleInput wrote {written}/{arr.Length}: {Marshal.GetLastWin32Error()}");
        Environment.Exit(5);
    }
    records.Clear();
}

static class NativeMethods
{
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] buf, uint len, out uint written);

    [StructLayout(LayoutKind.Explicit, Size = 20)]
    public struct INPUT_RECORD
    {
        [FieldOffset(0)] public ushort EventType; // 1 = KEY_EVENT
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode, Size = 16)]
    public struct KEY_EVENT_RECORD
    {
        [FieldOffset(0)] public int bKeyDown;
        [FieldOffset(4)] public ushort wRepeatCount;
        [FieldOffset(6)] public ushort wVirtualKeyCode;
        [FieldOffset(8)] public ushort wVirtualScanCode;
        [FieldOffset(10)] public char UnicodeChar;
        [FieldOffset(12)] public uint dwControlKeyState;
    }

    public static INPUT_RECORD Key(bool down, ushort vk, ushort scan, char c) => new()
    {
        EventType = 1,
        KeyEvent = new KEY_EVENT_RECORD
        {
            bKeyDown = down ? 1 : 0, wRepeatCount = 1, wVirtualKeyCode = vk,
            wVirtualScanCode = scan, UnicodeChar = c, dwControlKeyState = 0
        }
    };
}
```

- [ ] **Step 4: Build**

Run: `dotnet build ClaudeMonitor.sln`
Expected: Build succeeded, 0 errors (the Core test project builds with the template's default test; ignore it).

- [ ] **Step 5: Probe 1, injection into a fresh console (conhost or Windows Terminal, whichever this machine opens by default)**

```powershell
$log = "$env:TEMP\echo.log"
$echo = Start-Process dotnet -ArgumentList "run --no-build --project tools/spike/EchoConsole -- $log" -PassThru
Start-Sleep 4
$kid = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $echo.Id -and $_.Name -match 'EchoConsole|dotnet' } | Select-Object -First 1
$target = if ($kid) { $kid.ProcessId } else { $echo.Id }
dotnet run --no-build --project src/ClaudeMonitor.Inject -- $target "hi" --enter
Get-Content $log
```
Expected: log shows key events for `H`, `I` (char 104/105 may appear as lower-case `h`,`i` with KeyChar 104/105; Key may be `NoName`) and then `Enter` char 13. If `AttachConsole` fails or the log shows nothing, try the other PID (the `dotnet` host vs the `EchoConsole.exe` child). Record which PID worked. Then close the echo window.

- [ ] **Step 6: Probe 2, real Claude (spike questions 1, 2, 3)**

```powershell
$since = Get-Date
$p = Start-Process claude -WorkingDirectory "$PWD\tools\spike\scratch" -PassThru
Start-Sleep 8
# find the claude process (claude.exe or node running claude) started after $since
Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $since -and ($_.Name -match '^(claude|node)\.exe$') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | Format-List
```
(If a folder-trust prompt is showing, ask the user to accept it, then continue.) Use the printed `ProcessId` of the claude process as `$cp`:
```powershell
dotnet run --no-build --project src/ClaudeMonitor.Inject -- $cp "Reply with only the word PONG" --enter
Start-Sleep 12
$t = Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter *.jsonl | Where-Object { $_.LastWriteTime -gt $since } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Select-String -Path $t.FullName -Pattern 'Reply with only the word PONG','PONG' | Select-Object -First 3
```
Expected: transcript contains the user message and an assistant `PONG`. If the text appears in the transcript, question 1 (Windows Terminal/conhost reachable) = yes and question 3 (Enter not swallowed as newline) = yes. If it never submits, increase `enterDelayMs` to 600 and retry once; if still not submitted, try `charDelayMs = 20`. Record the settings that worked.

- [ ] **Step 7: Probe 3, `/clear` through the slash menu (question 2) and whether a new transcript appears (feeds question 5)**

```powershell
$before = Get-Date
dotnet run --no-build --project src/ClaudeMonitor.Inject -- $cp "/clear" --enter
Start-Sleep 5
dotnet run --no-build --project src/ClaudeMonitor.Inject -- $cp "Reply with only the word CLEARED" --enter
Start-Sleep 12
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter *.jsonl | Where-Object { $_.LastWriteTime -gt $before } | Select-Object FullName,LastWriteTime
```
Expected: a transcript file with a different name from the one in Step 6 contains `CLEARED` (so `/clear` executed and started a new session/transcript). If both messages land in the old file, the menu swallowed Enter or `/clear` didn't run; record exactly what happened and try sending `/clear` then a second `--enter` call.

- [ ] **Step 8: Write findings and decide the gate**

Create `docs/spike-findings.md` with: PID that worked (claude.exe vs node), whether `claude` is `claude.exe`, terminal host in use, final `charDelayMs`/`enterDelayMs`, answers to spec §5 questions 1, 2, 3 and whether `/clear` made a new transcript. If question 1 is no: STOP and tell the user (Option B needed). Close the scratch Claude window (`Stop-Process -Id $cp`).

---

### Task 2: Registration hook + settings.json install (spec §5 questions 4-5)

**Files:**
- Create: `hook/register.js`, `hook/register.test.js`, `hook/install-hook.js`, `hook/install-hook.test.js`
- Modify (via script only, backup first): `C:\Users\Jason_Weiss\.claude\settings.json`

**Interfaces:**
- Produces (`register.js` exports): `findClaudePid(table, startPid) -> number|null`, `buildRecord(input, pid, now?) -> object`, `writeRecord(dir, rec) -> void`.
- Produces (`install-hook.js` exports): `addHook(settings, command) -> settings`, `removeHook(settings, command) -> settings`. CLI: `node install-hook.js [--remove] <settingsPath>`.
- Registration file `<dir>\<session_id>.json`: `{ session_id, transcript_path, cwd, source, claude_pid, started_at(ISO) }`. Consumed by `SessionRegistry` (Task 6).

- [ ] **Step 1: Write failing tests for `register.js`**

`hook/register.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { findClaudePid, buildRecord, writeRecord } = require('./register');

const table = [
  { ProcessId: 10, ParentProcessId: 1, Name: 'WindowsTerminal.exe', CommandLine: 'wt' },
  { ProcessId: 20, ParentProcessId: 10, Name: 'cmd.exe', CommandLine: 'cmd /c claude-kevin.cmd' },
  { ProcessId: 30, ParentProcessId: 20, Name: 'claude.exe', CommandLine: 'claude --settings {}' },
  { ProcessId: 40, ParentProcessId: 30, Name: 'bash.exe', CommandLine: 'bash -c hook' },
  { ProcessId: 50, ParentProcessId: 40, Name: 'node.exe', CommandLine: 'node C:\\x\\claude-monitor\\hook\\register.js' },
];

test('finds claude.exe above the shell', () => {
  assert.strictEqual(findClaudePid(table, 50), 30);
});

test('finds node-hosted claude and ignores the hook itself', () => {
  const t = [
    { ProcessId: 3, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'node C:\\u\\@anthropic-ai\\claude-code\\cli.js' },
    { ProcessId: 4, ParentProcessId: 3, Name: 'node.exe', CommandLine: 'node C:\\x\\claude-monitor\\hook\\register.js' },
  ];
  assert.strictEqual(findClaudePid(t, 4), 3);
});

test('returns null when no claude ancestor', () => {
  assert.strictEqual(findClaudePid([{ ProcessId: 1, ParentProcessId: 0, Name: 'cmd.exe', CommandLine: '' }], 1), null);
});

test('survives a parent cycle', () => {
  const t = [{ ProcessId: 1, ParentProcessId: 2, Name: 'a.exe' }, { ProcessId: 2, ParentProcessId: 1, Name: 'b.exe' }];
  assert.strictEqual(findClaudePid(t, 1), null);
});

test('buildRecord maps hook input', () => {
  const r = buildRecord({ session_id: 's1', transcript_path: 'C:\\t.jsonl', cwd: 'C:\\p', source: 'clear' }, 30, new Date('2026-10-14T00:00:00Z'));
  assert.deepStrictEqual(r, { session_id: 's1', transcript_path: 'C:\\t.jsonl', cwd: 'C:\\p', source: 'clear', claude_pid: 30, started_at: '2026-10-14T00:00:00.000Z' });
});

test('buildRecord defaults source to startup', () => {
  assert.strictEqual(buildRecord({ session_id: 's' }, 1).source, 'startup');
});

test('writeRecord writes <id>.json atomically and overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
  writeRecord(dir, { session_id: 'abc', claude_pid: 1 });
  writeRecord(dir, { session_id: 'abc', claude_pid: 2 });
  assert.deepStrictEqual(fs.readdirSync(dir), ['abc.json']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'abc.json'), 'utf8')).claude_pid, 2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test hook/register.test.js`
Expected: FAIL, `Cannot find module './register'`.

- [ ] **Step 3: Implement `register.js`**

`hook/register.js`:
```js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function findClaudePid(table, startPid) {
  const byPid = new Map(table.map(p => [p.ProcessId, p]));
  const seen = new Set();
  let cur = byPid.get(startPid);
  while (cur && !seen.has(cur.ProcessId)) {
    seen.add(cur.ProcessId);
    const name = (cur.Name || '').toLowerCase();
    const cmd = (cur.CommandLine || '').toLowerCase();
    const isClaudeExe = name === 'claude.exe';
    const isNodeClaude = name === 'node.exe' && cmd.includes('claude') && !cmd.includes('register.js');
    if (isClaudeExe || isNodeClaude) return cur.ProcessId;
    cur = byPid.get(cur.ParentProcessId);
  }
  return null;
}

function buildRecord(input, pid, now = new Date()) {
  return {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd,
    source: input.source || 'startup',
    claude_pid: pid,
    started_at: now.toISOString(),
  };
}

function writeRecord(dir, rec) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, rec.session_id + '.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec));
  fs.renameSync(tmp, file);
}

function readProcessTable() {
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 8000 });
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function dataDir() {
  return path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'ClaudeMonitor');
}

function logError(msg) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(path.join(dataDir(), 'hook-errors.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* never fail the session start */ }
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw);
      const pid = findClaudePid(readProcessTable(), process.ppid);
      if (pid == null) { logError(`no claude ancestor for session ${input.session_id}`); return; }
      writeRecord(path.join(dataDir(), 'sessions'), buildRecord(input, pid));
    } catch (e) {
      logError(String(e && e.stack || e));
    }
  });
}

module.exports = { findClaudePid, buildRecord, writeRecord };
if (require.main === module) main();
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test hook/register.test.js`
Expected: 7 passing.

- [ ] **Step 5: Write failing tests for `install-hook.js`**

`hook/install-hook.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { addHook, removeHook, run } = require('./install-hook');

const CMD = 'node "C:/x/hook/register.js" 2>/dev/null || true';
const existing = () => ({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node other.js', timeout: 10 }] }] }, model: 'sonnet' });

test('addHook appends a second group and keeps the existing one', () => {
  const s = addHook(existing(), CMD);
  assert.strictEqual(s.hooks.SessionStart.length, 2);
  assert.strictEqual(s.hooks.SessionStart[0].hooks[0].command, 'node other.js');
  assert.strictEqual(s.hooks.SessionStart[1].hooks[0].command, CMD);
  assert.strictEqual(s.model, 'sonnet');
});

test('addHook is idempotent', () => {
  const s = addHook(addHook(existing(), CMD), CMD);
  assert.strictEqual(s.hooks.SessionStart.length, 2);
});

test('addHook creates hooks.SessionStart when absent', () => {
  assert.strictEqual(addHook({}, CMD).hooks.SessionStart.length, 1);
});

test('removeHook removes only our group', () => {
  const s = removeHook(addHook(existing(), CMD), CMD);
  assert.deepStrictEqual(s.hooks.SessionStart, existing().hooks.SessionStart);
});

test('run backs up, writes, and --remove restores shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, JSON.stringify(existing(), null, 2) + '\n');
  run([f], CMD);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('settings.json.bak-')));
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).hooks.SessionStart.length, 2);
  run(['--remove', f], CMD);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), existing());
});
```

- [ ] **Step 6: Run to verify failure**

Run: `node --test hook/install-hook.test.js`
Expected: FAIL, `Cannot find module './install-hook'`.

- [ ] **Step 7: Implement `install-hook.js`**

`hook/install-hook.js`:
```js
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_COMMAND = `node "${path.join(__dirname, 'register.js').replace(/\\/g, '/')}" 2>/dev/null || true`;

function addHook(settings, command) {
  settings.hooks = settings.hooks || {};
  const groups = settings.hooks.SessionStart = settings.hooks.SessionStart || [];
  const present = groups.some(g => (g.hooks || []).some(h => h.command === command));
  if (!present) groups.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  return settings;
}

function removeHook(settings, command) {
  const groups = settings.hooks && settings.hooks.SessionStart;
  if (!groups) return settings;
  settings.hooks.SessionStart = groups
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => h.command !== command) }))
    .filter(g => g.hooks.length > 0);
  return settings;
}

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function run(argv, command = DEFAULT_COMMAND) {
  const remove = argv.includes('--remove');
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) throw new Error('usage: node install-hook.js [--remove] <settingsPath>');
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.copyFileSync(file, `${file}.bak-${stamp()}`);
  const next = remove ? removeHook(settings, command) : addHook(settings, command);
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
}

module.exports = { addHook, removeHook, run, DEFAULT_COMMAND };
if (require.main === module) run(process.argv.slice(2));
```

- [ ] **Step 8: Run all hook tests**

Run: `node --test hook/`
Expected: all passing.

- [ ] **Step 9: Install the hook into the real settings.json (user-approved)**

Run: `node hook/install-hook.js C:\Users\Jason_Weiss\.claude\settings.json`
Expected: no output; `C:\Users\Jason_Weiss\.claude\settings.json.bak-<timestamp>` exists; `hooks.SessionStart` now has two groups; everything else in the file is unchanged (verify with `Compare-Object (Get-Content bak) (Get-Content settings.json)` showing only the added group). Do not touch `allowManagedHooksOnly`.

- [ ] **Step 10: Verify the hook fires (spec §5 questions 4, 5)**

```powershell
$sessions = "$env:LOCALAPPDATA\ClaudeMonitor\sessions"
$since = Get-Date
$p = Start-Process claude -WorkingDirectory "$PWD\tools\spike\scratch" -PassThru
Start-Sleep 10
Get-ChildItem $sessions -ErrorAction SilentlyContinue | Where-Object LastWriteTime -gt $since | ForEach-Object { Get-Content $_.FullName }
Get-Content "$env:LOCALAPPDATA\ClaudeMonitor\hook-errors.log" -ErrorAction SilentlyContinue
```
Expected: one JSON record with `source` `startup`, `claude_pid` equal to the claude process id, correct `cwd` and `transcript_path`.
- **No record and no error log:** the hook did not run. Likely cause: `allowManagedHooksOnly`. STOP and report to the user. Do not change the flag. Leave the hook entry installed and say so.
- **Error log says "no claude ancestor":** adjust `findClaudePid` to the real process names found in Task 1 Step 6, add a test row for them, rerun Step 8.
Then repeat with `claude-kevin` instead of `claude` (question 4): the record must also appear. Then in one session run `inject.exe <pid> "/clear" --enter` and confirm a second record appears with `source` `clear` and the same `claude_pid` (question 5). Append all answers to `docs/spike-findings.md`; close the scratch windows.

---

### Task 3: Transcript parsing and incremental tail

**Files:**
- Create: `src/ClaudeMonitor.Core/TranscriptEntry.cs`, `src/ClaudeMonitor.Core/TranscriptParser.cs`, `src/ClaudeMonitor.Core/SessionTail.cs`, `tests/ClaudeMonitor.Core.Tests/Fx.cs`, `tests/ClaudeMonitor.Core.Tests/TranscriptParserTests.cs`, `tests/ClaudeMonitor.Core.Tests/SessionTailTests.cs`
- Delete: the template's `UnitTest1.cs` in the test project.

**Interfaces:**
- Produces: `enum EntryKind { UserText, UserToolResult, AssistantText, AssistantToolUse, AssistantThinking, TurnEnd }`; `record TranscriptEntry(EntryKind Kind, string Uuid, string Text, string? StopReason, IReadOnlyList<string> ToolUseIds, IReadOnlyList<string> ToolResultIds)`; `TranscriptParser.Parse(string line) -> TranscriptEntry?` (null for irrelevant/malformed lines); `SessionTail(string path, bool baselineToEnd)` with `List<TranscriptEntry> Entries`, `long Length`, `DateTimeOffset LastWrite`, `bool Poll()`.
- Produces test helper `Fx`: `Assistant(text, stop="end_turn", uuid="a1")`, `ToolUse(id, uuid="t1")`, `ToolResult(id, uuid="r1")`, `User(text, uuid="u1")`, `TurnEnd(uuid="s1")`, `Parse(params string[] lines)`.
- Real transcript facts this relies on: each content block is its own JSONL line; `type` is `assistant`/`user`/`system`; `message.stop_reason` is `end_turn` on the final text entry; turn end also writes `{"type":"system","subtype":"turn_duration"}`.

- [ ] **Step 1: Test helper**

Delete `tests/ClaudeMonitor.Core.Tests/UnitTest1.cs`. Create `tests/ClaudeMonitor.Core.Tests/Fx.cs`:
```csharp
using System.Text.Json;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public static class Fx
{
    public static string Assistant(string text, string? stop = "end_turn", string uuid = "a1") =>
        JsonSerializer.Serialize(new { type = "assistant", uuid, message = new { role = "assistant", stop_reason = stop, content = new object[] { new { type = "text", text } } } });

    public static string ToolUse(string id, string uuid = "t1") =>
        JsonSerializer.Serialize(new { type = "assistant", uuid, message = new { role = "assistant", stop_reason = "tool_use", content = new object[] { new { type = "tool_use", id, name = "Bash" } } } });

    public static string ToolResult(string id, string uuid = "r1") =>
        JsonSerializer.Serialize(new { type = "user", uuid, message = new { role = "user", content = new object[] { new { type = "tool_result", tool_use_id = id, content = "ok" } } } });

    public static string User(string text, string uuid = "u1") =>
        JsonSerializer.Serialize(new { type = "user", uuid, message = new { role = "user", content = text } });

    public static string TurnEnd(string uuid = "s1") =>
        JsonSerializer.Serialize(new { type = "system", subtype = "turn_duration", uuid, durationMs = 5 });

    public static List<TranscriptEntry> Parse(params string[] lines) =>
        lines.Select(TranscriptParser.Parse).Where(e => e is not null).Select(e => e!).ToList();
}
```

- [ ] **Step 2: Failing parser tests**

`tests/ClaudeMonitor.Core.Tests/TranscriptParserTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class TranscriptParserTests
{
    [Fact]
    public void Assistant_text_with_end_turn()
    {
        var e = TranscriptParser.Parse(Fx.Assistant("hello", "end_turn", "x"))!;
        Assert.Equal(EntryKind.AssistantText, e.Kind);
        Assert.Equal("hello", e.Text);
        Assert.Equal("end_turn", e.StopReason);
        Assert.Equal("x", e.Uuid);
    }

    [Fact]
    public void Assistant_tool_use_collects_ids()
    {
        var e = TranscriptParser.Parse(Fx.ToolUse("toolu_1"))!;
        Assert.Equal(EntryKind.AssistantToolUse, e.Kind);
        Assert.Equal(new[] { "toolu_1" }, e.ToolUseIds);
    }

    [Fact]
    public void User_tool_result_collects_ids()
    {
        var e = TranscriptParser.Parse(Fx.ToolResult("toolu_1"))!;
        Assert.Equal(EntryKind.UserToolResult, e.Kind);
        Assert.Equal(new[] { "toolu_1" }, e.ToolResultIds);
    }

    [Fact]
    public void User_string_content_is_user_text()
    {
        var e = TranscriptParser.Parse(Fx.User("go"))!;
        Assert.Equal(EntryKind.UserText, e.Kind);
        Assert.Equal("go", e.Text);
    }

    [Fact]
    public void Turn_duration_is_turn_end()
    {
        Assert.Equal(EntryKind.TurnEnd, TranscriptParser.Parse(Fx.TurnEnd())!.Kind);
    }

    [Fact]
    public void Thinking_only_is_thinking()
    {
        var line = """{"type":"assistant","uuid":"q","message":{"role":"assistant","stop_reason":null,"content":[{"type":"thinking","thinking":""}]}}""";
        var e = TranscriptParser.Parse(line)!;
        Assert.Equal(EntryKind.AssistantThinking, e.Kind);
        Assert.Null(e.StopReason);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("""{"type":"mode","mode":"normal"}""")]
    [InlineData("""{"type":"attachment","uuid":"z"}""")]
    [InlineData("""{"type":"system","subtype":"other","uuid":"z"}""")]
    public void Irrelevant_or_malformed_lines_return_null(string line)
    {
        Assert.Null(TranscriptParser.Parse(line));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests`
Expected: build FAIL (types not defined).

- [ ] **Step 4: Implement entry + parser**

`src/ClaudeMonitor.Core/TranscriptEntry.cs`:
```csharp
namespace ClaudeMonitor.Core;

public enum EntryKind { UserText, UserToolResult, AssistantText, AssistantToolUse, AssistantThinking, TurnEnd }

public sealed record TranscriptEntry(
    EntryKind Kind,
    string Uuid,
    string Text,
    string? StopReason,
    IReadOnlyList<string> ToolUseIds,
    IReadOnlyList<string> ToolResultIds);
```

`src/ClaudeMonitor.Core/TranscriptParser.cs`:
```csharp
using System.Text;
using System.Text.Json;

namespace ClaudeMonitor.Core;

public static class TranscriptParser
{
    static readonly string[] None = [];

    public static TranscriptEntry? Parse(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        JsonDocument doc;
        try { doc = JsonDocument.Parse(line); }
        catch (JsonException) { return null; }

        using (doc)
        {
            var root = doc.RootElement;
            var type = Str(root, "type");
            var uuid = Str(root, "uuid") ?? "";

            if (type == "system")
                return Str(root, "subtype") == "turn_duration"
                    ? new TranscriptEntry(EntryKind.TurnEnd, uuid, "", null, None, None)
                    : null;

            if (type is not ("assistant" or "user")) return null;
            if (!root.TryGetProperty("message", out var msg) || msg.ValueKind != JsonValueKind.Object) return null;

            var text = new StringBuilder();
            var uses = new List<string>();
            var results = new List<string>();
            if (msg.TryGetProperty("content", out var content))
            {
                if (content.ValueKind == JsonValueKind.String) text.Append(content.GetString());
                else if (content.ValueKind == JsonValueKind.Array)
                    foreach (var b in content.EnumerateArray())
                        switch (Str(b, "type"))
                        {
                            case "text": text.Append(Str(b, "text")); break;
                            case "tool_use": uses.Add(Str(b, "id") ?? ""); break;
                            case "tool_result": results.Add(Str(b, "tool_use_id") ?? ""); break;
                        }
            }

            var stop = msg.TryGetProperty("stop_reason", out var sr) && sr.ValueKind == JsonValueKind.String ? sr.GetString() : null;
            EntryKind kind = type == "user"
                ? (results.Count > 0 ? EntryKind.UserToolResult : EntryKind.UserText)
                : uses.Count > 0 ? EntryKind.AssistantToolUse
                : text.Length > 0 ? EntryKind.AssistantText
                : EntryKind.AssistantThinking;
            return new TranscriptEntry(kind, uuid, text.ToString(), stop, uses, results);
        }
    }

    static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;
}
```

- [ ] **Step 5: Run parser tests**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter TranscriptParserTests`
Expected: all passing.

- [ ] **Step 6: Failing tail tests**

`tests/ClaudeMonitor.Core.Tests/SessionTailTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SessionTailTests : IDisposable
{
    readonly string path = Path.Combine(Path.GetTempPath(), "tail-" + Guid.NewGuid() + ".jsonl");
    public void Dispose() { if (File.Exists(path)) File.Delete(path); }

    [Fact]
    public void Reads_from_start_when_not_baselined()
    {
        File.WriteAllText(path, Fx.User("hi") + "\n" + Fx.Assistant("yo") + "\n");
        var t = new SessionTail(path, baselineToEnd: false);
        Assert.True(t.Poll() || t.Entries.Count == 2);
        Assert.Equal(2, t.Entries.Count);
    }

    [Fact]
    public void Baseline_ignores_existing_content_but_sees_new_lines()
    {
        File.WriteAllText(path, Fx.Assistant("old /clear request") + "\n");
        var t = new SessionTail(path, baselineToEnd: true);
        Assert.False(t.Poll());
        Assert.Empty(t.Entries);
        File.AppendAllText(path, Fx.Assistant("new", "end_turn", "n1") + "\n");
        Assert.True(t.Poll());
        Assert.Equal("n1", Assert.Single(t.Entries).Uuid);
    }

    [Fact]
    public void Partial_trailing_line_waits_for_newline()
    {
        var line = Fx.Assistant("half");
        File.WriteAllText(path, line[..20]);
        var t = new SessionTail(path, false);
        Assert.Empty(t.Entries);
        File.AppendAllText(path, line[20..] + "\n");
        Assert.True(t.Poll());
        Assert.Single(t.Entries);
    }

    [Fact]
    public void Missing_file_is_not_an_error_and_reports_length_and_mtime()
    {
        var t = new SessionTail(path, false);
        Assert.False(t.Poll());
        File.WriteAllText(path, Fx.User("x") + "\n");
        Assert.True(t.Poll());
        Assert.Equal(new FileInfo(path).Length, t.Length);
        Assert.True((DateTimeOffset.UtcNow - t.LastWrite).TotalSeconds < 30);
    }

    [Fact]
    public void Unicode_survives_multibyte_boundaries()
    {
        File.WriteAllText(path, Fx.Assistant("héllo → ✓") + "\n");
        var t = new SessionTail(path, false);
        Assert.Equal("héllo → ✓", Assert.Single(t.Entries).Text);
    }
}
```

- [ ] **Step 7: Run to verify failure**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter SessionTailTests`
Expected: build FAIL (`SessionTail` not defined).

- [ ] **Step 8: Implement `SessionTail`**

`src/ClaudeMonitor.Core/SessionTail.cs`:
```csharp
using System.Text;

namespace ClaudeMonitor.Core;

public sealed class SessionTail
{
    readonly string path;
    long offset;

    public List<TranscriptEntry> Entries { get; } = new();
    public long Length { get; private set; }
    public DateTimeOffset LastWrite { get; private set; }

    public SessionTail(string path, bool baselineToEnd)
    {
        this.path = path;
        if (baselineToEnd && File.Exists(path)) offset = new FileInfo(path).Length;
        Poll();
    }

    /// <summary>Reads any newly completed lines. Returns true if bytes were consumed.</summary>
    public bool Poll()
    {
        if (!File.Exists(path)) return false;
        var info = new FileInfo(path);
        Length = info.Length;
        LastWrite = new DateTimeOffset(info.LastWriteTimeUtc, TimeSpan.Zero);
        if (info.Length <= offset) return false;

        var buf = new byte[info.Length - offset];
        var total = 0;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            fs.Seek(offset, SeekOrigin.Begin);
            while (total < buf.Length)
            {
                var n = fs.Read(buf, total, buf.Length - total);
                if (n == 0) break;
                total += n;
            }
        }
        if (total == 0) return false;
        var end = Array.LastIndexOf(buf, (byte)'\n', total - 1);
        if (end < 0) return false;

        foreach (var line in Encoding.UTF8.GetString(buf, 0, end + 1).Split('\n'))
        {
            var e = TranscriptParser.Parse(line);
            if (e is not null) Entries.Add(e);
        }
        offset += end + 1;
        return true;
    }
}
```

- [ ] **Step 9: Run all Core tests**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests`
Expected: all passing.

---

### Task 4: ClearPrompt and Detector

**Files:**
- Create: `src/ClaudeMonitor.Core/ClearPrompt.cs`, `src/ClaudeMonitor.Core/Detector.cs`, `tests/ClaudeMonitor.Core.Tests/ClearPromptTests.cs`, `tests/ClaudeMonitor.Core.Tests/DetectorTests.cs`

**Interfaces:**
- Consumes: `TranscriptEntry`, `EntryKind` (Task 3), `Fx` helper.
- Produces: `ClearPrompt.Asks(string text, int tailParagraphs = 1) -> bool`; `record DetectorOptions(TimeSpan Quiet, int TailParagraphs = 1)`; `enum DetectKind { Skip, Fire }`; `record Detection(DetectKind Kind, string Reason, string? MessageUuid = null, string? MessageText = null)`; `Detector.Evaluate(IReadOnlyList<TranscriptEntry> entries, DateTimeOffset lastWrite, DateTimeOffset now, DetectorOptions options) -> Detection`.

- [ ] **Step 1: Failing ClearPrompt tests (covers Review Focus 1)**

`tests/ClaudeMonitor.Core.Tests/ClearPromptTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class ClearPromptTests
{
    [Theory]
    [InlineData("Done. Run `/clear` and read .claude/handoff/x.md.")]
    [InlineData("Context is large, please /clear before continuing.")]
    [InlineData("When the run is finished, tell the user to `/clear` before the next task.")]
    [InlineData("Handoff written.\n\nNext step: type /clear, then read the handoff.")]
    [InlineData("RUN /CLEAR now")]
    public void Real_prompts_match(string text) => Assert.True(ClearPrompt.Asks(text));

    [Theory]
    [InlineData("`/clear` is a built-in command, so a hook can't run it.")]
    [InlineData("Don't run /clear yet.")]
    [InlineData("There is no need to /clear here.")]
    [InlineData("I will never run /clear myself.")]
    [InlineData("Does section 1 look right, and should I carry on?")]
    [InlineData("Use the clear button.")]
    [InlineData("See C:\\tools\\clear for details.")]
    public void Discussion_and_negations_do_not_match(string text) => Assert.False(ClearPrompt.Asks(text));

    [Fact]
    public void Fenced_code_is_ignored()
    {
        Assert.False(ClearPrompt.Asks("Example:\n```\nrun /clear\n```"));
    }

    [Fact]
    public void Block_quotes_are_ignored()
    {
        Assert.False(ClearPrompt.Asks("> run /clear\n"));
    }

    [Fact]
    public void Only_the_last_paragraph_counts()
    {
        var text = "1. Type `/clear` and press Enter.\n\nDoes this look right?";
        Assert.False(ClearPrompt.Asks(text));
        Assert.True(ClearPrompt.Asks("Does this look right?\n\nRun /clear when ready.", 1));
    }

    [Fact]
    public void Tail_paragraph_count_is_configurable()
    {
        var text = "Run /clear first.\n\nThen carry on.";
        Assert.False(ClearPrompt.Asks(text, 1));
        Assert.True(ClearPrompt.Asks(text, 2));
    }

    [Fact]
    public void Handles_crlf_and_empty()
    {
        Assert.True(ClearPrompt.Asks("Intro\r\n\r\nRun /clear now."));
        Assert.False(ClearPrompt.Asks(""));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter ClearPromptTests`
Expected: build FAIL (`ClearPrompt` not defined).

- [ ] **Step 3: Implement `ClearPrompt`**

`src/ClaudeMonitor.Core/ClearPrompt.cs`:
```csharp
using System.Text.RegularExpressions;

namespace ClaudeMonitor.Core;

public static class ClearPrompt
{
    static readonly Regex Fence = new(@"```.*?```", RegexOptions.Singleline | RegexOptions.Compiled);
    static readonly Regex ParagraphBreak = new(@"\n\s*\n", RegexOptions.Compiled);
    static readonly Regex Positive = new(
        @"\b(run|type|enter|use|execute|please|then|now|should|to)\s+`?/clear\b(?![\w-])",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Negative = new(
        @"\b(don't|do not|never|not|no need to|without|didn't|already)\b[^.\n`]{0,25}/clear",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool Asks(string text, int tailParagraphs = 1)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        var t = Fence.Replace(text.Replace("\r\n", "\n"), "");
        t = string.Join("\n", t.Split('\n').Where(l => !l.TrimStart().StartsWith('>')));
        var paragraphs = ParagraphBreak.Split(t).Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
        var tail = string.Join("\n", paragraphs.TakeLast(Math.Max(1, tailParagraphs)));
        return Positive.IsMatch(tail) && !Negative.IsMatch(tail);
    }
}
```

- [ ] **Step 4: Run ClearPrompt tests**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter ClearPromptTests`
Expected: all passing. If a row fails, adjust the regexes (not the test) until all rows pass while keeping the whole suite green.

- [ ] **Step 5: Failing Detector tests**

`tests/ClaudeMonitor.Core.Tests/DetectorTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class DetectorTests
{
    static readonly DateTimeOffset Now = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
    static readonly DetectorOptions Opts = new(TimeSpan.FromSeconds(5));
    const string Ask = "Handoff written. Run /clear and read .claude/handoff/x.md.";

    static Detection Eval(string[] lines, double quietSecondsAgo = 10) =>
        Detector.Evaluate(Fx.Parse(lines), Now.AddSeconds(-quietSecondsAgo), Now, Opts);

    [Fact]
    public void Fires_on_idle_end_turn_with_request()
    {
        var d = Eval([Fx.User("go"), Fx.Assistant(Ask, "end_turn", "m1"), Fx.TurnEnd()]);
        Assert.Equal(DetectKind.Fire, d.Kind);
        Assert.Equal("m1", d.MessageUuid);
        Assert.Equal(Ask, d.MessageText);
    }

    [Fact]
    public void Skips_when_not_quiet_yet()
    {
        var d = Eval([Fx.User("go"), Fx.Assistant(Ask)], quietSecondsAgo: 1);
        Assert.Equal(DetectKind.Skip, d.Kind);
        Assert.Contains("quiet", d.Reason);
    }

    [Fact]
    public void Skips_when_stop_reason_is_not_end_turn()
    {
        Assert.Equal(DetectKind.Skip, Eval([Fx.User("go"), Fx.Assistant(Ask, "tool_use")]).Kind);
    }

    [Fact]
    public void Skips_when_a_later_user_message_follows()
    {
        Assert.Equal(DetectKind.Skip, Eval([Fx.Assistant(Ask), Fx.User("ok wait")]).Kind);
    }

    [Fact]
    public void Skips_when_text_has_no_clear_request()
    {
        Assert.Equal(DetectKind.Skip, Eval([Fx.User("go"), Fx.Assistant("All done.")]).Kind);
    }

    [Fact]
    public void Skips_when_a_tool_call_in_this_turn_has_no_result()
    {
        var d = Eval([Fx.User("go"), Fx.ToolUse("t1"), Fx.Assistant(Ask)]);
        Assert.Equal(DetectKind.Skip, d.Kind);
        Assert.Contains("tool", d.Reason);
    }

    [Fact]
    public void Resolved_tool_calls_do_not_block()
    {
        var d = Eval([Fx.User("go"), Fx.ToolUse("t1"), Fx.ToolResult("t1"), Fx.Assistant(Ask)]);
        Assert.Equal(DetectKind.Fire, d.Kind);
    }

    [Fact]
    public void Orphan_tool_call_from_an_earlier_turn_does_not_block()
    {
        var d = Eval([Fx.User("first"), Fx.ToolUse("old"), Fx.User("second"), Fx.Assistant(Ask)]);
        Assert.Equal(DetectKind.Fire, d.Kind);
    }

    [Fact]
    public void Skips_empty()
    {
        Assert.Equal(DetectKind.Skip, Eval([]).Kind);
    }
}
```

- [ ] **Step 6: Run to verify failure**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter DetectorTests`
Expected: build FAIL (`Detector` not defined).

- [ ] **Step 7: Implement `Detector`**

`src/ClaudeMonitor.Core/Detector.cs`:
```csharp
namespace ClaudeMonitor.Core;

public sealed record DetectorOptions(TimeSpan Quiet, int TailParagraphs = 1);

public enum DetectKind { Skip, Fire }

public sealed record Detection(DetectKind Kind, string Reason, string? MessageUuid = null, string? MessageText = null);

public static class Detector
{
    public static Detection Evaluate(
        IReadOnlyList<TranscriptEntry> entries, DateTimeOffset lastWrite, DateTimeOffset now, DetectorOptions options)
    {
        TranscriptEntry? last = null;
        var lastIndex = -1;
        for (var i = entries.Count - 1; i >= 0; i--)
        {
            if (entries[i].Kind is EntryKind.AssistantThinking or EntryKind.TurnEnd) continue;
            last = entries[i]; lastIndex = i; break;
        }
        if (last is null) return Skip("no entries");
        if (last.Kind != EntryKind.AssistantText || last.StopReason != "end_turn") return Skip("not at end of turn");
        if (!ClearPrompt.Asks(last.Text, options.TailParagraphs)) return Skip("no /clear request");

        var turnStart = 0;
        for (var i = lastIndex; i >= 0; i--)
            if (entries[i].Kind == EntryKind.UserText) { turnStart = i; break; }
        var open = new HashSet<string>();
        for (var i = turnStart; i <= lastIndex; i++)
        {
            foreach (var id in entries[i].ToolUseIds) open.Add(id);
            foreach (var id in entries[i].ToolResultIds) open.Remove(id);
        }
        if (open.Count > 0) return Skip("tool call pending");

        if (now - lastWrite < options.Quiet) return Skip("transcript not quiet yet");
        return new Detection(DetectKind.Fire, "idle end-of-turn /clear request", last.Uuid, last.Text);
    }

    static Detection Skip(string reason) => new(DetectKind.Skip, reason);
}
```

- [ ] **Step 8: Run all Core tests**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests`
Expected: all passing.

---

### Task 5: HandoffResolver

**Files:**
- Create: `src/ClaudeMonitor.Core/HandoffResolver.cs`, `tests/ClaudeMonitor.Core.Tests/HandoffResolverTests.cs`

**Interfaces:**
- Produces: `HandoffResolver.Resolve(string message, string cwd, DateTimeOffset sessionStart) -> string?` (absolute path or null).

- [ ] **Step 1: Failing tests (covers Review Focus 5)**

`tests/ClaudeMonitor.Core.Tests/HandoffResolverTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class HandoffResolverTests : IDisposable
{
    readonly string cwd = Path.Combine(Path.GetTempPath(), "ho-" + Guid.NewGuid());
    readonly string dir;
    readonly DateTimeOffset start = DateTimeOffset.UtcNow.AddMinutes(-10);

    public HandoffResolverTests()
    {
        dir = Path.Combine(cwd, ".claude", "handoff");
        Directory.CreateDirectory(dir);
    }
    public void Dispose() => Directory.Delete(cwd, true);

    string Make(string name, int minutesOld = 1)
    {
        var p = Path.Combine(dir, name);
        File.WriteAllText(p, "x");
        File.SetLastWriteTimeUtc(p, DateTime.UtcNow.AddMinutes(-minutesOld));
        return p;
    }

    [Fact]
    public void Absolute_path_in_message_wins_and_trailing_punctuation_is_ignored()
    {
        var p = Make("a.md");
        Make("b.md", 0);
        Assert.Equal(p, HandoffResolver.Resolve($"Run /clear and read `{p}`.", cwd, start));
        Assert.Equal(p, HandoffResolver.Resolve($"Run /clear and read {p}.", cwd, start));
    }

    [Fact]
    public void Relative_path_resolves_against_cwd()
    {
        var p = Make("rel.md");
        Assert.Equal(p, HandoffResolver.Resolve("Read .claude/handoff/rel.md now", cwd, start));
    }

    [Fact]
    public void Path_with_spaces_is_found_when_quoted_in_backticks()
    {
        var p = Path.Combine(dir, "my handoff.md");
        File.WriteAllText(p, "x");
        Assert.Equal(p, HandoffResolver.Resolve($"Run /clear and read `{p}`", cwd, start));
    }

    [Fact]
    public void Missing_named_file_falls_back_to_newest_after_session_start()
    {
        Make("old.md", 60);
        var newest = Make("new.md", 2);
        Assert.Equal(newest, HandoffResolver.Resolve("read .claude/handoff/gone.md", cwd, start));
    }

    [Fact]
    public void Ledger_is_never_chosen()
    {
        Make("LEDGER.md", 0);
        Assert.Null(HandoffResolver.Resolve("Run /clear", cwd, start));
    }

    [Fact]
    public void Nothing_newer_than_session_start_returns_null()
    {
        Make("old.md", 60);
        Assert.Null(HandoffResolver.Resolve("Run /clear", cwd, start));
    }

    [Fact]
    public void Missing_handoff_dir_returns_null()
    {
        Assert.Null(HandoffResolver.Resolve("Run /clear", Path.Combine(cwd, "nope"), start));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter HandoffResolverTests`
Expected: build FAIL (`HandoffResolver` not defined).

- [ ] **Step 3: Implement**

`src/ClaudeMonitor.Core/HandoffResolver.cs`:
```csharp
using System.Text.RegularExpressions;

namespace ClaudeMonitor.Core;

public static class HandoffResolver
{
    static readonly Regex Backticked = new(@"`([^`\r\n]+?\.md)`", RegexOptions.Compiled);
    static readonly Regex Abs = new(@"[A-Za-z]:[\\/][^\s`'""<>|*?]+?\.md", RegexOptions.Compiled);
    static readonly Regex Rel = new(@"\.claude[\\/]handoff[\\/][^\s`'""<>|*?]+?\.md", RegexOptions.Compiled);

    public static string? Resolve(string message, string cwd, DateTimeOffset sessionStart)
    {
        var candidates = Backticked.Matches(message).Select(m => m.Groups[1].Value)
            .Concat(Abs.Matches(message).Select(m => m.Value))
            .Concat(Rel.Matches(message).Select(m => m.Value));
        foreach (var c in candidates)
        {
            var p = Path.IsPathRooted(c) ? c : Path.Combine(cwd, c);
            if (File.Exists(p)) return Path.GetFullPath(p);
        }

        var dir = Path.Combine(cwd, ".claude", "handoff");
        if (!Directory.Exists(dir)) return null;
        return Directory.EnumerateFiles(dir, "*.md")
            .Where(f => !Path.GetFileName(f).Equals("LEDGER.md", StringComparison.OrdinalIgnoreCase))
            .Where(f => File.GetLastWriteTimeUtc(f) > sessionStart.UtcDateTime)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }
}
```

- [ ] **Step 4: Run all Core tests**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests`
Expected: all passing.

---

### Task 6: Safety primitives and session registry

**Files:**
- Create: `src/ClaudeMonitor.Core/RateLimiter.cs`, `ActedStore.cs`, `DecisionLog.cs`, `SessionInfo.cs`, `SessionRegistry.cs`, `tests/ClaudeMonitor.Core.Tests/SafetyTests.cs`, `tests/ClaudeMonitor.Core.Tests/SessionRegistryTests.cs`

**Interfaces:**
- Produces: `RateLimiter(TimeSpan cooldown, int maxPerWindow, TimeSpan window)` with `bool TryAcquire(string key, DateTimeOffset now, out string reason)` (reasons `"cooldown"`, `"rate limit"`); `ActedStore(string path)` with `bool Has(string uuid)`, `void Add(string uuid)`; `DecisionLog(string path)` with `void Write(string sessionId, string action, string reason, string? uuid = null)`; `record SessionInfo(string SessionId, string TranscriptPath, string Cwd, string Source, int ClaudePid, DateTimeOffset StartedAt)`; `SessionRegistry(string dir)` with `IReadOnlyList<SessionInfo> Load(Func<int,bool> isAlive)`.
- Consumes: registration JSON shape from Task 2 (`session_id`, `transcript_path`, `cwd`, `source`, `claude_pid`, `started_at`).

- [ ] **Step 1: Failing tests**

`tests/ClaudeMonitor.Core.Tests/SafetyTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SafetyTests : IDisposable
{
    readonly string dir = Path.Combine(Path.GetTempPath(), "safe-" + Guid.NewGuid());
    static readonly DateTimeOffset T = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
    public SafetyTests() => Directory.CreateDirectory(dir);
    public void Dispose() => Directory.Delete(dir, true);

    [Fact]
    public void Cooldown_blocks_same_key_then_releases()
    {
        var r = new RateLimiter(TimeSpan.FromSeconds(60), 10, TimeSpan.FromMinutes(10));
        Assert.True(r.TryAcquire("pid1", T, out _));
        Assert.False(r.TryAcquire("pid1", T.AddSeconds(30), out var why));
        Assert.Equal("cooldown", why);
        Assert.True(r.TryAcquire("pid1", T.AddSeconds(61), out _));
    }

    [Fact]
    public void Different_keys_do_not_share_cooldown()
    {
        var r = new RateLimiter(TimeSpan.FromSeconds(60), 10, TimeSpan.FromMinutes(10));
        Assert.True(r.TryAcquire("pid1", T, out _));
        Assert.True(r.TryAcquire("pid2", T, out _));
    }

    [Fact]
    public void Window_cap_applies_across_keys()
    {
        var r = new RateLimiter(TimeSpan.Zero, 3, TimeSpan.FromMinutes(10));
        Assert.True(r.TryAcquire("a", T, out _));
        Assert.True(r.TryAcquire("b", T.AddSeconds(1), out _));
        Assert.True(r.TryAcquire("c", T.AddSeconds(2), out _));
        Assert.False(r.TryAcquire("d", T.AddSeconds(3), out var why));
        Assert.Equal("rate limit", why);
        Assert.True(r.TryAcquire("d", T.AddMinutes(11), out _));
    }

    [Fact]
    public void ActedStore_persists_across_instances()
    {
        var p = Path.Combine(dir, "acted.txt");
        var a = new ActedStore(p);
        Assert.False(a.Has("u1"));
        a.Add("u1");
        a.Add("u1");
        Assert.True(a.Has("u1"));
        Assert.True(new ActedStore(p).Has("u1"));
        Assert.Single(File.ReadAllLines(p));
    }

    [Fact]
    public void DecisionLog_appends_json_lines_and_creates_directory()
    {
        var p = Path.Combine(dir, "sub", "decisions.jsonl");
        var log = new DecisionLog(p);
        log.Write("s1", "skip", "paused", "u1");
        log.Write("s1", "inject", "/clear sent");
        var lines = File.ReadAllLines(p);
        Assert.Equal(2, lines.Length);
        Assert.Contains("\"action\":\"skip\"", lines[0]);
        Assert.Contains("\"uuid\":\"u1\"", lines[0]);
    }
}
```

`tests/ClaudeMonitor.Core.Tests/SessionRegistryTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SessionRegistryTests : IDisposable
{
    readonly string dir = Path.Combine(Path.GetTempPath(), "reg-" + Guid.NewGuid());
    public SessionRegistryTests() => Directory.CreateDirectory(dir);
    public void Dispose() => Directory.Delete(dir, true);

    void Write(string id, int pid, string startedAt, string source = "startup", string cwd = "C:\\p") =>
        File.WriteAllText(Path.Combine(dir, id + ".json"),
            $$"""{"session_id":"{{id}}","transcript_path":"C:\\t\\{{id}}.jsonl","cwd":"{{cwd.Replace("\\", "\\\\")}}","source":"{{source}}","claude_pid":{{pid}},"started_at":"{{startedAt}}"}""");

    [Fact]
    public void Loads_records()
    {
        Write("s1", 100, "2026-10-14T10:00:00.000Z");
        var s = Assert.Single(new SessionRegistry(dir).Load(_ => true));
        Assert.Equal("s1", s.SessionId);
        Assert.Equal(100, s.ClaudePid);
        Assert.Equal("startup", s.Source);
        Assert.Equal(new DateTimeOffset(2026, 10, 14, 10, 0, 0, TimeSpan.Zero), s.StartedAt);
    }

    [Fact]
    public void Dead_pids_are_ignored()
    {
        Write("s1", 100, "2026-10-14T10:00:00.000Z");
        Write("s2", 200, "2026-10-14T10:00:00.000Z");
        var s = Assert.Single(new SessionRegistry(dir).Load(pid => pid == 200));
        Assert.Equal("s2", s.SessionId);
    }

    [Fact]
    public void Latest_registration_per_pid_wins()
    {
        Write("old", 100, "2026-10-14T10:00:00.000Z");
        Write("new", 100, "2026-10-14T10:05:00.000Z", "clear");
        var s = Assert.Single(new SessionRegistry(dir).Load(_ => true));
        Assert.Equal("new", s.SessionId);
        Assert.Equal("clear", s.Source);
    }

    [Fact]
    public void Two_sessions_in_same_cwd_with_different_pids_are_both_kept()
    {
        Write("a", 100, "2026-10-14T10:00:00.000Z");
        Write("b", 200, "2026-10-14T10:00:00.000Z");
        Assert.Equal(2, new SessionRegistry(dir).Load(_ => true).Count);
    }

    [Fact]
    public void Malformed_and_partial_files_are_skipped()
    {
        File.WriteAllText(Path.Combine(dir, "bad.json"), "{not json");
        File.WriteAllText(Path.Combine(dir, "half.json"), """{"session_id":"x"}""");
        File.WriteAllText(Path.Combine(dir, "x.json.tmp"), "{}");
        Write("ok", 1, "2026-10-14T10:00:00.000Z");
        Assert.Equal("ok", Assert.Single(new SessionRegistry(dir).Load(_ => true)).SessionId);
    }

    [Fact]
    public void Missing_directory_returns_empty()
    {
        Assert.Empty(new SessionRegistry(Path.Combine(dir, "none")).Load(_ => true));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests`
Expected: build FAIL (types not defined).

- [ ] **Step 3: Implement**

`src/ClaudeMonitor.Core/RateLimiter.cs`:
```csharp
namespace ClaudeMonitor.Core;

public sealed class RateLimiter
{
    readonly TimeSpan cooldown, window;
    readonly int max;
    readonly Dictionary<string, DateTimeOffset> last = new();
    readonly Queue<DateTimeOffset> recent = new();

    public RateLimiter(TimeSpan cooldown, int maxPerWindow, TimeSpan window)
    {
        this.cooldown = cooldown; max = maxPerWindow; this.window = window;
    }

    public bool TryAcquire(string key, DateTimeOffset now, out string reason)
    {
        reason = "";
        if (last.TryGetValue(key, out var t) && now - t < cooldown) { reason = "cooldown"; return false; }
        while (recent.Count > 0 && now - recent.Peek() >= window) recent.Dequeue();
        if (recent.Count >= max) { reason = "rate limit"; return false; }
        last[key] = now;
        recent.Enqueue(now);
        return true;
    }
}
```

`src/ClaudeMonitor.Core/ActedStore.cs`:
```csharp
namespace ClaudeMonitor.Core;

public sealed class ActedStore
{
    readonly string path;
    readonly HashSet<string> seen;

    public ActedStore(string path)
    {
        this.path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        seen = File.Exists(path) ? File.ReadAllLines(path).Where(l => l.Length > 0).ToHashSet() : new HashSet<string>();
    }

    public bool Has(string uuid) => seen.Contains(uuid);

    public void Add(string uuid)
    {
        if (seen.Add(uuid)) File.AppendAllText(path, uuid + "\n");
    }
}
```

`src/ClaudeMonitor.Core/DecisionLog.cs`:
```csharp
using System.Text.Json;

namespace ClaudeMonitor.Core;

public sealed class DecisionLog
{
    readonly string path;
    readonly object gate = new();

    public DecisionLog(string path)
    {
        this.path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
    }

    public void Write(string sessionId, string action, string reason, string? uuid = null)
    {
        var line = JsonSerializer.Serialize(new { ts = DateTimeOffset.Now, session = sessionId, action, reason, uuid });
        lock (gate) File.AppendAllText(path, line + "\n");
    }
}
```

`src/ClaudeMonitor.Core/SessionInfo.cs`:
```csharp
namespace ClaudeMonitor.Core;

public sealed record SessionInfo(
    string SessionId, string TranscriptPath, string Cwd, string Source, int ClaudePid, DateTimeOffset StartedAt);
```

`src/ClaudeMonitor.Core/SessionRegistry.cs`:
```csharp
using System.Globalization;
using System.Text.Json;

namespace ClaudeMonitor.Core;

public sealed class SessionRegistry
{
    readonly string dir;
    public SessionRegistry(string dir) => this.dir = dir;

    public IReadOnlyList<SessionInfo> Load(Func<int, bool> isAlive)
    {
        if (!Directory.Exists(dir)) return [];
        var all = new List<SessionInfo>();
        foreach (var file in Directory.EnumerateFiles(dir, "*.json"))
        {
            var info = TryRead(file);
            if (info is not null && isAlive(info.ClaudePid)) all.Add(info);
        }
        return all.GroupBy(s => s.ClaudePid).Select(g => g.OrderByDescending(s => s.StartedAt).First()).ToList();
    }

    static SessionInfo? TryRead(string file)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            var r = doc.RootElement;
            return new SessionInfo(
                r.GetProperty("session_id").GetString()!,
                r.GetProperty("transcript_path").GetString()!,
                r.GetProperty("cwd").GetString()!,
                r.GetProperty("source").GetString()!,
                r.GetProperty("claude_pid").GetInt32(),
                DateTimeOffset.Parse(r.GetProperty("started_at").GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal));
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or IOException or FormatException)
        {
            return null;
        }
    }
}
```

- [ ] **Step 4: Run all Core tests**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests`
Expected: all passing.

---

### Task 7: Orchestrator

**Files:**
- Create: `src/ClaudeMonitor.Core/Orchestrator.cs`, `tests/ClaudeMonitor.Core.Tests/OrchestratorTests.cs`

**Interfaces:**
- Consumes: `Detection`, `SessionInfo`, `RateLimiter`, `ActedStore`, `DecisionLog`, `HandoffResolver`.
- Produces: `interface IInjector { Task<bool> SendAsync(int claudePid, string text, bool enter, CancellationToken ct); }`; `record OrchestratorOptions(bool DryRun, TimeSpan ConfirmTimeout, TimeSpan PollInterval, TimeSpan PostClearDelay)`; `Orchestrator(IInjector, RateLimiter, ActedStore, DecisionLog, Func<bool> isPaused, Func<IReadOnlyList<SessionInfo>> loadSessions, Func<string,long> fileLength, OrchestratorOptions)` with `Task HandleAsync(SessionInfo session, Detection detection, long lengthAtDetection, CancellationToken ct)`.
- Read line sent: `Read "<absolute handoff path>" and follow its instructions.`
- Decision log actions: `dry-run`, `skip` (reasons `paused`, `cooldown`, `rate limit`), `abort` (`transcript changed`), `inject`, `done`, `error`.

- [ ] **Step 1: Failing tests (covers Review Focus 3 and 5)**

`tests/ClaudeMonitor.Core.Tests/OrchestratorTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class OrchestratorTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "orch-" + Guid.NewGuid());
    readonly string cwd;
    readonly string logPath;
    readonly List<SessionInfo> sessions = new();
    readonly SessionInfo s1;
    readonly FakeInjector inj;
    long length = 100;
    bool paused;

    sealed class FakeInjector(Func<string, Task> onSend) : IInjector
    {
        public List<string> Sent { get; } = new();
        public bool Result { get; set; } = true;
        public async Task<bool> SendAsync(int pid, string text, bool enter, CancellationToken ct)
        {
            Sent.Add(text);
            await onSend(text);
            return Result;
        }
    }

    public OrchestratorTests()
    {
        cwd = Path.Combine(root, "proj");
        Directory.CreateDirectory(Path.Combine(cwd, ".claude", "handoff"));
        logPath = Path.Combine(root, "decisions.jsonl");
        s1 = new SessionInfo("s1", Path.Combine(root, "t.jsonl"), cwd, "startup", 4242, DateTimeOffset.UtcNow.AddMinutes(-30));
        sessions.Add(s1);
        inj = new FakeInjector(text =>
        {
            if (text == "/clear" && registerClear)
                sessions.Add(new SessionInfo("s2", s1.TranscriptPath, cwd, "clear", 4242, DateTimeOffset.UtcNow));
            return Task.CompletedTask;
        });
    }
    bool registerClear = true;
    public void Dispose() => Directory.Delete(root, true);

    string Handoff()
    {
        var p = Path.Combine(cwd, ".claude", "handoff", "h.md");
        File.WriteAllText(p, "x");
        return p;
    }

    Orchestrator Make(bool dry = false, RateLimiter? limiter = null, ActedStore? acted = null) => new(
        inj,
        limiter ?? new RateLimiter(TimeSpan.Zero, 100, TimeSpan.FromMinutes(10)),
        acted ?? new ActedStore(Path.Combine(root, "acted.txt")),
        new DecisionLog(logPath),
        () => paused,
        () => sessions.ToList(),
        _ => length,
        new OrchestratorOptions(dry, TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(10), TimeSpan.Zero));

    static Detection Fire(string uuid = "m1", string text = "Run /clear") =>
        new(DetectKind.Fire, "x", uuid, text);

    string Log() => File.Exists(logPath) ? File.ReadAllText(logPath) : "";

    [Fact]
    public async Task Dry_run_logs_and_injects_nothing()
    {
        Handoff();
        await Make(dry: true).HandleAsync(s1, Fire(), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("dry-run", Log());
    }

    [Fact]
    public async Task Live_sends_clear_then_read_after_new_clear_session_registers()
    {
        var h = Handoff();
        await Make().HandleAsync(s1, Fire(text: $"Run /clear and read `{h}`"), 100, default);
        Assert.Equal(new[] { "/clear", $"Read \"{h}\" and follow its instructions." }, inj.Sent);
    }

    [Fact]
    public async Task No_handoff_means_clear_only()
    {
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
        Assert.Contains("clear only", Log());
    }

    [Fact]
    public async Task Timeout_waiting_for_new_session_sends_no_read_line()
    {
        Handoff();
        registerClear = false;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
        Assert.Contains("\"action\":\"error\"", Log());
    }

    [Fact]
    public async Task Clear_inject_failure_is_logged_and_stops()
    {
        Handoff();
        inj.Result = false;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
        Assert.Contains("\"action\":\"error\"", Log());
    }

    [Fact]
    public async Task Paused_does_nothing_but_logs()
    {
        paused = true;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("paused", Log());
    }

    [Fact]
    public async Task Changed_transcript_aborts()
    {
        length = 250;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("transcript changed", Log());
    }

    [Fact]
    public async Task Same_message_uuid_is_only_acted_on_once()
    {
        var o = Make();
        await o.HandleAsync(s1, Fire("dup"), 100, default);
        inj.Sent.Clear();
        await o.HandleAsync(s1, Fire("dup"), 100, default);
        Assert.Empty(inj.Sent);
    }

    [Fact]
    public async Task Acted_uuid_survives_restart()
    {
        var path = Path.Combine(root, "acted.txt");
        await Make(acted: new ActedStore(path)).HandleAsync(s1, Fire("p1"), 100, default);
        inj.Sent.Clear();
        await Make(acted: new ActedStore(path)).HandleAsync(s1, Fire("p1"), 100, default);
        Assert.Empty(inj.Sent);
    }

    [Fact]
    public async Task Cooldown_blocks_a_second_message_for_the_same_pid()
    {
        var limiter = new RateLimiter(TimeSpan.FromMinutes(1), 100, TimeSpan.FromMinutes(10));
        var o = Make(limiter: limiter);
        await o.HandleAsync(s1, Fire("a"), 100, default);
        inj.Sent.Clear();
        await o.HandleAsync(s1, Fire("b"), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("cooldown", Log());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter OrchestratorTests`
Expected: build FAIL (`Orchestrator` not defined).

- [ ] **Step 3: Implement**

`src/ClaudeMonitor.Core/Orchestrator.cs`:
```csharp
namespace ClaudeMonitor.Core;

public interface IInjector
{
    Task<bool> SendAsync(int claudePid, string text, bool enter, CancellationToken ct);
}

public sealed record OrchestratorOptions(bool DryRun, TimeSpan ConfirmTimeout, TimeSpan PollInterval, TimeSpan PostClearDelay);

public sealed class Orchestrator
{
    readonly IInjector injector;
    readonly RateLimiter limiter;
    readonly ActedStore acted;
    readonly DecisionLog log;
    readonly Func<bool> isPaused;
    readonly Func<IReadOnlyList<SessionInfo>> loadSessions;
    readonly Func<string, long> fileLength;
    readonly OrchestratorOptions options;

    public Orchestrator(IInjector injector, RateLimiter limiter, ActedStore acted, DecisionLog log, Func<bool> isPaused,
        Func<IReadOnlyList<SessionInfo>> loadSessions, Func<string, long> fileLength, OrchestratorOptions options)
    {
        this.injector = injector; this.limiter = limiter; this.acted = acted; this.log = log;
        this.isPaused = isPaused; this.loadSessions = loadSessions; this.fileLength = fileLength; this.options = options;
    }

    public async Task HandleAsync(SessionInfo s, Detection d, long lengthAtDetection, CancellationToken ct)
    {
        var uuid = d.MessageUuid!;
        if (acted.Has(uuid)) return;
        acted.Add(uuid); // one action per message, whatever the outcome

        if (isPaused()) { log.Write(s.SessionId, "skip", "paused", uuid); return; }
        if (!limiter.TryAcquire(s.ClaudePid.ToString(), DateTimeOffset.UtcNow, out var why))
        { log.Write(s.SessionId, "skip", why, uuid); return; }

        var handoff = HandoffResolver.Resolve(d.MessageText ?? "", s.Cwd, s.StartedAt);
        if (options.DryRun)
        {
            log.Write(s.SessionId, "dry-run", $"would /clear then read: {handoff ?? "(none)"}", uuid);
            return;
        }
        if (fileLength(s.TranscriptPath) != lengthAtDetection)
        { log.Write(s.SessionId, "abort", "transcript changed", uuid); return; }

        if (!await injector.SendAsync(s.ClaudePid, "/clear", true, ct))
        { log.Write(s.SessionId, "error", "inject /clear failed", uuid); return; }
        log.Write(s.SessionId, "inject", "/clear sent", uuid);

        if (handoff is null) { log.Write(s.SessionId, "done", "clear only (no handoff found)", uuid); return; }

        var deadline = DateTimeOffset.UtcNow + options.ConfirmTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            var fresh = loadSessions().FirstOrDefault(x =>
                x.ClaudePid == s.ClaudePid && x.SessionId != s.SessionId && x.Source == "clear");
            if (fresh is not null)
            {
                if (options.PostClearDelay > TimeSpan.Zero) await Task.Delay(options.PostClearDelay, ct);
                var line = $"Read \"{handoff}\" and follow its instructions.";
                if (await injector.SendAsync(s.ClaudePid, line, true, ct))
                    log.Write(fresh.SessionId, "inject", $"read-handoff sent: {handoff}", uuid);
                else
                    log.Write(fresh.SessionId, "error", "inject read-handoff failed", uuid);
                return;
            }
            await Task.Delay(options.PollInterval, ct);
        }
        log.Write(s.SessionId, "error", "timeout waiting for new session after /clear; handoff not sent", uuid);
    }
}
```

- [ ] **Step 4: Run all Core tests**

Run: `dotnet test tests/ClaudeMonitor.Core.Tests`
Expected: all passing.

---

### Task 8: Daemon wiring, ProcessInjector, end-to-end

**Files:**
- Create: `src/ClaudeMonitor/ProcessInjector.cs`, `src/ClaudeMonitor/Options.cs`
- Modify: `src/ClaudeMonitor/Program.cs`
- Create: `tests/ClaudeMonitor.Core.Tests/BaselineTests.cs`

**Interfaces:**
- Consumes: everything from Tasks 3-7; `inject.exe` from Task 1 (use the final `charDelayMs`/`enterDelayMs` from `docs/spike-findings.md`; update `src/ClaudeMonitor.Inject/Program.cs` constants to those values before building).
- Produces: `ClaudeMonitor.exe [--live] [--data <dir>] [--quiet <sec>] [--confirm-timeout <sec>] [--inject <path>]`. Default data dir `%LOCALAPPDATA%\ClaudeMonitor`; default inject path `<exe dir>\inject.exe`. Runs until Ctrl+C.

- [ ] **Step 1: Failing baseline test (Review Focus 2, logic part)**

`tests/ClaudeMonitor.Core.Tests/BaselineTests.cs`:
```csharp
using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class BaselineTests : IDisposable
{
    readonly string path = Path.Combine(Path.GetTempPath(), "base-" + Guid.NewGuid() + ".jsonl");
    public void Dispose() { if (File.Exists(path)) File.Delete(path); }

    [Fact]
    public void Old_clear_request_present_when_daemon_starts_never_fires()
    {
        File.WriteAllText(path, Fx.User("go") + "\n" + Fx.Assistant("Run /clear now.", "end_turn", "old") + "\n");
        var tail = new SessionTail(path, baselineToEnd: true);
        tail.Poll();
        var d = Detector.Evaluate(tail.Entries, tail.LastWrite.AddMinutes(-5), DateTimeOffset.UtcNow, new DetectorOptions(TimeSpan.FromSeconds(5)));
        Assert.Equal(DetectKind.Skip, d.Kind);
    }

    [Fact]
    public void New_request_appended_after_daemon_start_fires_once_quiet()
    {
        File.WriteAllText(path, Fx.User("go") + "\n");
        var tail = new SessionTail(path, baselineToEnd: true);
        File.AppendAllText(path, Fx.Assistant("Run /clear now.", "end_turn", "new") + "\n");
        tail.Poll();
        var d = Detector.Evaluate(tail.Entries, tail.LastWrite.AddMinutes(-5), DateTimeOffset.UtcNow, new DetectorOptions(TimeSpan.FromSeconds(5)));
        Assert.Equal(DetectKind.Fire, d.Kind);
        Assert.Equal("new", d.MessageUuid);
    }
}
```
Run: `dotnet test tests/ClaudeMonitor.Core.Tests --filter BaselineTests`
Expected: PASS already (it exercises Tasks 3-4; this pins the restart behavior). If it fails, fix the Core code, not the test.

- [ ] **Step 2: Options parser**

`src/ClaudeMonitor/Options.cs`:
```csharp
namespace ClaudeMonitor;

public sealed record Options(string DataDir, bool Live, TimeSpan Quiet, TimeSpan ConfirmTimeout, string InjectPath)
{
    public static Options Parse(string[] args)
    {
        string Arg(string name, string fallback)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
        }
        var data = Arg("--data", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeMonitor"));
        return new Options(
            data,
            args.Contains("--live"),
            TimeSpan.FromSeconds(double.Parse(Arg("--quiet", "5"))),
            TimeSpan.FromSeconds(double.Parse(Arg("--confirm-timeout", "20"))),
            Arg("--inject", Path.Combine(AppContext.BaseDirectory, "inject.exe")));
    }
}
```

- [ ] **Step 3: ProcessInjector**

`src/ClaudeMonitor/ProcessInjector.cs`:
```csharp
using System.Diagnostics;
using ClaudeMonitor.Core;

namespace ClaudeMonitor;

public sealed class ProcessInjector(string injectPath) : IInjector
{
    public async Task<bool> SendAsync(int claudePid, string text, bool enter, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(injectPath)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true, RedirectStandardOutput = true,
        };
        psi.ArgumentList.Add(claudePid.ToString());
        psi.ArgumentList.Add(text);
        if (enter) psi.ArgumentList.Add("--enter");

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("could not start inject.exe");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            await p.WaitForExitAsync(timeout.Token);
            return p.ExitCode == 0;
        }
        catch (OperationCanceledException)
        {
            try { p.Kill(true); } catch { /* already gone */ }
            return false;
        }
    }
}
```

- [ ] **Step 4: Daemon loop**

`src/ClaudeMonitor/Program.cs`:
```csharp
using System.Diagnostics;
using ClaudeMonitor;
using ClaudeMonitor.Core;

var opt = Options.Parse(args);
Directory.CreateDirectory(opt.DataDir);
var startedAt = DateTimeOffset.UtcNow;
var log = new DecisionLog(Path.Combine(opt.DataDir, "decisions.jsonl"));
var acted = new ActedStore(Path.Combine(opt.DataDir, "acted.txt"));
var registry = new SessionRegistry(Path.Combine(opt.DataDir, "sessions"));
var pausePath = Path.Combine(opt.DataDir, "PAUSE");

static bool IsAlive(int pid)
{
    try { using var p = Process.GetProcessById(pid); return !p.HasExited; }
    catch { return false; }
}

var orchestrator = new Orchestrator(
    new ProcessInjector(opt.InjectPath),
    new RateLimiter(TimeSpan.FromSeconds(60), 3, TimeSpan.FromMinutes(10)),
    acted, log,
    () => File.Exists(pausePath),
    () => registry.Load(IsAlive),
    path => File.Exists(path) ? new FileInfo(path).Length : 0,
    new OrchestratorOptions(!opt.Live, opt.ConfirmTimeout, TimeSpan.FromMilliseconds(500), TimeSpan.FromSeconds(1)));

var detectorOptions = new DetectorOptions(opt.Quiet);
var tails = new Dictionary<string, SessionTail>();
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

Console.WriteLine($"ClaudeMonitor started. mode={(opt.Live ? "LIVE" : "DRY-RUN")} data={opt.DataDir} quiet={opt.Quiet.TotalSeconds}s");
log.Write("-", "start", $"mode={(opt.Live ? "live" : "dry-run")}");

while (!cts.IsCancellationRequested)
{
    try
    {
        var sessions = registry.Load(IsAlive);
        foreach (var gone in tails.Keys.Where(id => sessions.All(s => s.SessionId != id)).ToList()) tails.Remove(gone);

        foreach (var s in sessions)
        {
            if (!tails.TryGetValue(s.SessionId, out var tail))
                tails[s.SessionId] = tail = new SessionTail(s.TranscriptPath, baselineToEnd: s.StartedAt < startedAt);
            tail.Poll();
            var d = Detector.Evaluate(tail.Entries, tail.LastWrite, DateTimeOffset.UtcNow, detectorOptions);
            if (d.Kind == DetectKind.Fire && !acted.Has(d.MessageUuid!))
                await orchestrator.HandleAsync(s, d, tail.Length, cts.Token);
        }
    }
    catch (OperationCanceledException) { break; }
    catch (Exception e)
    {
        log.Write("-", "error", e.GetType().Name + ": " + e.Message);
    }
    try { await Task.Delay(500, cts.Token); } catch (OperationCanceledException) { break; }
}
log.Write("-", "stop", "shutdown");
```

- [ ] **Step 5: Publish both exes into one folder and run all tests**

```powershell
dotnet test tests/ClaudeMonitor.Core.Tests
dotnet publish src/ClaudeMonitor.Inject -c Release -o artifacts
dotnet publish src/ClaudeMonitor -c Release -o artifacts
Test-Path artifacts\inject.exe, artifacts\ClaudeMonitor.exe
```
Expected: tests pass; both `Test-Path` results are `True`.

- [ ] **Step 6: End-to-end, dry-run first**

Prepare a handoff and start the daemon (dry-run is the default):
```powershell
New-Item -ItemType Directory -Force tools\spike\scratch\.claude\handoff | Out-Null
Set-Content tools\spike\scratch\.claude\handoff\e2e.md "When read, reply with exactly HANDOFF-OK."
$h = (Resolve-Path tools\spike\scratch\.claude\handoff\e2e.md).Path
Start-Process artifacts\ClaudeMonitor.exe -ArgumentList "--quiet 3" -PassThru   # note: new console window
$p = Start-Process claude -WorkingDirectory "$PWD\tools\spike\scratch" -PassThru
Start-Sleep 10
Get-ChildItem "$env:LOCALAPPDATA\ClaudeMonitor\sessions" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content
```
Take `claude_pid` from the record as `$cp`, then:
```powershell
dotnet artifacts\inject.dll $cp "Reply with exactly this sentence and nothing else: Run /clear and read $h." --enter
Start-Sleep 25
Get-Content "$env:LOCALAPPDATA\ClaudeMonitor\decisions.jsonl" -Tail 5
```
Expected: a `dry-run` decision containing `would /clear then read: <path to e2e.md>`; Claude's session was NOT cleared. If no decision appears, check that Claude's reply ended with the sentence (transcript), that it is the last paragraph, and `hook-errors.log`.

- [ ] **Step 7: End-to-end, live**

Stop the dry-run daemon (close its window). Delete `$env:LOCALAPPDATA\ClaudeMonitor\acted.txt` so the test message is eligible again, then:
```powershell
Start-Process artifacts\ClaudeMonitor.exe -ArgumentList "--live --quiet 3" -PassThru
Start-Sleep 3
dotnet artifacts\inject.dll $cp "Reply with exactly this sentence and nothing else: Run /clear and read $h." --enter
Start-Sleep 45
Get-Content "$env:LOCALAPPDATA\ClaudeMonitor\decisions.jsonl" -Tail 8
$t = Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter *.jsonl | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Select-String -Path $t.FullName -Pattern 'HANDOFF-OK','follow its instructions' | Select-Object -First 4
```
Expected: decisions show `inject /clear sent` then `inject read-handoff sent`; the newest transcript is a NEW session (different file from before) containing the user line `Read "...e2e.md" and follow its instructions.` and an assistant reply `HANDOFF-OK`. (The old daemon baseline test: restart the daemon now and confirm no new action is logged for the old session, Review Focus 2.)

- [ ] **Step 8: End-to-end, safety controls and kevin**

1. **Pause:** `New-Item "$env:LOCALAPPDATA\ClaudeMonitor\PAUSE"`; repeat the live trigger with a fresh message; expect a `skip paused` decision and no injection. Remove the file afterwards.
2. **claude-kevin:** start the scratch session with `claude-kevin` instead of `claude`; repeat the live trigger; expect the same successful sequence.
3. **Typing guard:** while the daemon is waiting out the quiet period (use `--quiet 15`), type a character in the session's prompt and submit; expect an `abort transcript changed` or no action (the message is no longer the last entry).
4. Close the scratch sessions and the daemon. Append results to `docs/spike-findings.md`.

- [ ] **Step 9: Operating notes**

Add to the top of `docs/spike-findings.md` a short "How to run" block: build command (Step 5), `artifacts\ClaudeMonitor.exe` (dry-run), `--live`, the pause file path, the decision log path, the known gap from Review Focus 3, and the hook uninstall command `node hook\install-hook.js --remove C:\Users\Jason_Weiss\.claude\settings.json`.

---

## Self-Review (spec coverage)

| Spec requirement | Task |
|---|---|
| §3.1 registration hook, `claude_pid` via parent chain, settings.json entry as second `SessionStart` group, backup, never alter existing hook | 2 |
| §3.1 risk: `allowManagedHooksOnly` may block; test, report, don't change the flag | 2 (Step 10) |
| §3.2 triggers: end-of-turn, imperative `/clear`, outside fences/quotes, idle, no pending tool, uuid once | 3, 4, 7 |
| §3.2 handoff resolution order | 5 |
| §3.3 injector (`AttachConsole` + `WriteConsoleInputW`, separate process, Enter separate event) | 1, 8 |
| §3.4 sequence incl. confirm via `source=clear`, timeout without read line | 7, 8 |
| §4 abort on activity, registered live PIDs only, rate limits, dry-run default, pause file, JSONL log | 6, 7, 8 |
| §5 spike questions 1-5 | 1 (1-3), 2 (4-5) |
| §6 testing: detector fixtures incl. false positives, injector vs echo console then real claude, no Docker | 1, 3-7, 8 |
| kevin / `claude-kevin` support | 2 (Step 10), 8 (Step 8) |
| Out of scope: `/compact`, other surfaces | not implemented by design |

Placeholder scan: none. Type consistency: `Detection`, `DetectorOptions`, `SessionInfo`, `IInjector`, `OrchestratorOptions`, `Orchestrator.HandleAsync(SessionInfo, Detection, long, CancellationToken)` are defined once (Tasks 4, 6, 7) and used with identical signatures in Task 8.
