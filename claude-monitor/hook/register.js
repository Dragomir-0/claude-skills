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
