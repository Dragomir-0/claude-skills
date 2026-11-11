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
