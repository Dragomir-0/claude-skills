#!/usr/bin/env node
// SessionStart hook: if a handoff document is waiting for this project (written by
// context-threshold-check.js just before /clear), load it as context and consume it.
const fs = require('fs');
const os = require('os');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function safeName(p) {
  return (p || 'unknown').replace(/[^A-Za-z0-9]/g, '-');
}

const raw = readStdin();
let input = {};
try {
  input = JSON.parse(raw);
} catch (e) {
  process.exit(0);
}

const cwd = input.cwd || process.cwd();
const name = safeName(cwd);
const handoffDir = path.join(os.homedir(), '.claude', 'handoff');
const handoffPath = path.join(handoffDir, `${name}.md`);
const flagPath = path.join(handoffDir, `${name}.requested`);
const waivedPath = path.join(handoffDir, `${name}.waived`);

if (!fs.existsSync(handoffPath)) process.exit(0);

const content = fs.readFileSync(handoffPath, 'utf8');
fs.rmSync(handoffPath, { force: true });
fs.rmSync(flagPath, { force: true });
fs.rmSync(waivedPath, { force: true });

const additionalContext =
  'Resuming from a handoff document written just before the context window was cleared:\n\n' + content;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}));
