#!/usr/bin/env node
// UserPromptSubmit hook: when the transcript grows past ~150k tokens (approximated
// by byte size), tell Claude to write a handoff document and ask the user to /clear.
// Once asked, this ENFORCES the clear: every later prompt in the session is blocked
// until the user runs /clear, or expressly waives it by including WAIVER_PHRASE.
const fs = require('fs');
const os = require('os');
const path = require('path');

const WAIVER_PHRASE = 'i waive the context clear';

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

const transcriptPath = input.transcript_path;
const cwd = input.cwd || process.cwd();
const promptText = (input.prompt || '').trim();

if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

const THRESHOLD_BYTES = 600000; // ~150k tokens at a rough 4-bytes-per-token heuristic

const handoffDir = path.join(os.homedir(), '.claude', 'handoff');
const name = safeName(cwd);
const handoffPath = path.join(handoffDir, `${name}.md`);
const flagPath = path.join(handoffDir, `${name}.requested`);
const waivedPath = path.join(handoffDir, `${name}.waived`);

// Let the real /clear command through untouched - it's the resolution being enforced.
if (promptText === '/clear' || promptText.startsWith('/clear ')) process.exit(0);

// Already asked for a handoff this session: enforce until /clear or an express waiver.
if (fs.existsSync(flagPath)) {
  if (fs.existsSync(waivedPath)) process.exit(0);

  if (promptText.toLowerCase().includes(WAIVER_PHRASE)) {
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(waivedPath, new Date().toISOString());
    process.exit(0);
  }

  process.stderr.write(
    'Context window crossed ~150k tokens and a handoff has been written. ' +
    'Run /clear to continue (your next message will resume from the handoff), ' +
    `or type "${WAIVER_PHRASE}" to explicitly waive this and keep going.`
  );
  process.exit(2);
}

const size = fs.statSync(transcriptPath).size;
if (size <= THRESHOLD_BYTES) process.exit(0);

fs.mkdirSync(handoffDir, { recursive: true });
fs.writeFileSync(flagPath, new Date().toISOString());

const additionalContext =
  'Context window has crossed ~150k tokens (approximate, based on transcript size). ' +
  `Before doing anything else this turn: write a handoff document to "${handoffPath}" ` +
  '(create the file; overwrite if it exists) summarizing (1) the current task and goal, ' +
  '(2) key decisions made so far, (3) files touched/created and why, (4) exact next steps ' +
  'to resume the work. Then tell the user the context threshold was hit and they must run ' +
  '/clear now to continue - their next message will automatically load this handoff document. ' +
  `If they want to keep going without clearing, they must say so by including the exact ` +
  `phrase "${WAIVER_PHRASE}" in their next message; otherwise every message they send will ` +
  'be blocked until they /clear.';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext,
  },
}));
