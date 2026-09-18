---
name: context-threshold-hook
description: >
  Background infrastructure: automatically monitors transcript size and enforces context window
  clearing when ~150k tokens are reached. Writes a handoff document on threshold, pauses further
  prompts until /clear or explicit waiver, then resumes from the handoff on session restart.
disable-model-invocation: false
allowed-tools: none (hook infrastructure only)
---

# context-threshold-hook

Automatic context window management for long-running sessions. Two coordinated hooks that work
transparently in the background:

## How it works

**`context-threshold-check.js`** (UserPromptSubmit hook):
- Monitors transcript size (~600KB ≈ 150k tokens)
- When threshold is crossed:
  - Signals Claude to write a handoff document (current task, decisions, files touched, next steps)
  - Blocks all subsequent prompts with an explanatory error
  - User must either run `/clear` OR type `"i waive the context clear"` to continue

**`context-resume.js`** (SessionStart hook):
- Runs when a new session starts (after `/clear`)
- Loads the handoff document as additional context
- Cleans up marker files to reset the cycle

## Install

### Option 1: Full integration (recommended)

Copy the hook files and merge settings into your config:

```bash
# Copy hooks
cp context-threshold-hook/*.js ~/.claude/hooks/

# Merge settings-snippet.json into ~/.claude/settings.json
# Add under the top-level "hooks" key (see settings-snippet.json)
```

### Option 2: Manual setup

1. Copy `context-threshold-check.js` and `context-resume.js` to `~/.claude/hooks/`
2. Merge the `"UserPromptSubmit"` and `"SessionStart"` entries from `settings-snippet.json` into
   your `~/.claude/settings.json` under `"hooks"`
3. Restart Claude Code

## Tuning

Edit `context-threshold-check.js`:
- Line 10: `WAIVER_PHRASE` — change the exact text users must type to bypass
- Line 38: `THRESHOLD_BYTES` — adjust trigger point (600000 ≈ 150k tokens, ~4 bytes/token)

## Requirements

- Node.js on PATH (plain Node scripts, no npm install needed)

## State files

Temporary marker files live in `~/.claude/handoff/<sanitized-cwd>.{md,requested,waived}`. Safe
to delete manually if something gets stuck.

## Notes

- The enforcement mechanism uses Claude Code's exit-code 2 convention (documented, will not break
  on version updates)
- Handoff documents are workspace-specific (keyed by sanitized working directory path)
- The `/clear` command always passes through unblocked, even if enforcement is active
