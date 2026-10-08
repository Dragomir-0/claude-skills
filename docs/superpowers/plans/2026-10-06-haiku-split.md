# haiku-split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, current session). Subagent-driven execution is **not allowed** by the user's global CLAUDE.md. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/haiku-split <skill>` skill that decomposes any skill into Haiku-sized tasks and runs them as chained Haiku segments under the 14 context-barrier rules.

**Architecture:** A markdown skill (`SKILL.md`) plus four templates. The skill reads a target skill, classifies and splits its steps, writes `TASKS.md`, `handoff-0.md`, `notes.md`, `progress.log` and a generated `workflow.js` into a run folder, asks the user to confirm, then launches the Workflow tool. The script is rendered from `workflow.js.tmpl` by substituting `{{TOKENS}}`. Authored in the repo (`Projects/claude-skills/haiku-split/`), then copied to `~/.claude/skills/haiku-split/`.

**Tech Stack:** Markdown skill files, a JavaScript Workflow script (plain JS, no TypeScript, no `Date`/`Math.random`, no filesystem access in the script body), bash for the structural check, Node for `node --check`.

**Spec:** `Projects/claude-skills/docs/superpowers/specs/2026-10-06-haiku-split-design.md`

## Global Constraints

- Haiku model ID is exactly `claude-haiku-4-5-20251001`, set explicitly on every `agent()` call.
- Segment `LIMIT` default 100000 tokens; task target about 20000 tokens or less; both overridable per run.
- The user confirms each run before launch; confirmation covers that one run only (including each resume).
- The skill reads no project source code; segments never invoke the target skill and never ask the user questions.
- Standalone: no edits to existing skills or `_shared/pipeline-contract.md`.
- Run folder: `<cwd>/.claude/haiku-split/<skill-name>/<YYYYMMDD-HHMM>/`.
- Any write outside the project (`~/.claude/skills`, `~/.claude/CLAUDE.md`) needs the user's explicit approval at that moment.
- Commits only when the user says so.

## Review Focus

- Target skill name does not exist: stop and list available skills, never guess.
- Target is `haiku-split` itself: refuse.
- Target skill has no steps a Haiku segment can safely do (all `main`/`pause`): report and do not generate a workflow.
- Segment never sees the `<total_tokens>` counter: the barrier cannot fire, so the smoke test must detect this and the spec §11 records the outcome.
- A `pause`/`main` block is the next task: segment must return `blocked`, not skip it.
- Resume after `blocked`: segment numbering continues (`startSegment`), handoff files are not overwritten.

---

### Task 1: Sync the spec with two design refinements

**Files:**
- Modify: `Projects/claude-skills/docs/superpowers/specs/2026-10-06-haiku-split-design.md`

**Interfaces:**
- Produces: spec text that matches what Tasks 2-6 build (`<skill>` accepts a path; task block has `Depends on`; resume uses `args.startSegment`).

- [ ] **Step 1: Let `<skill-name>` also accept a path (needed for the smoke test fixture)**

In section 3, replace

```
`<skill-name>` resolves to `~/.claude/skills/<skill-name>/SKILL.md`. If it does not exist, stop and
list the available skills. `haiku-split` cannot target itself.
```

with

```
`<skill-name>` resolves to `~/.claude/skills/<skill-name>/SKILL.md`. If the argument contains a
path separator or ends in `SKILL.md`, it is used as that path instead (this is how the smoke test
points at a fixture). If nothing resolves, stop and list the available skills. `haiku-split`
cannot target itself.
```

- [ ] **Step 2: Add `Depends on` to the task block in section 5**

Replace the line `- Inputs: <exact file paths / prior task outputs>` with

```
- Depends on: <task ids, or none>
- Inputs: <exact file paths / prior task outputs>
```

- [ ] **Step 3: Replace the resume mechanism in section 4 step 8**

Replace step 8 with

```
8. **Resume at pauses.** When the workflow returns `blocked` at a `pause`/`main` step, the main
   session does that step or gets the user's answer and appends `DONE-MAIN <id>` to
   `progress.log`. It then launches a fresh run of the same `workflow.js` with
   `args: { startSegment: <last segment + 1> }` after the user confirms (D1 applies to every
   launch, including resumes). Segment numbering continues, so handoff files are never overwritten.
```

- [ ] **Step 4: Verify**

Run: `grep -c "startSegment" Projects/claude-skills/docs/superpowers/specs/2026-10-06-haiku-split-design.md; grep -c "Depends on" Projects/claude-skills/docs/superpowers/specs/2026-10-06-haiku-split-design.md`
Expected: `1` and `1` (or higher), no `0`.

---

### Task 2: Write the structural check (fails first)

**Files:**
- Create: `Projects/claude-skills/haiku-split/tests/check.sh`

**Interfaces:**
- Produces: `bash haiku-split/tests/check.sh [skill-dir]` exits 0 only if every required file and string is present and the rendered workflow script parses. Default `skill-dir` is the directory above `tests/`.

- [ ] **Step 1: Write the check script**

````bash
#!/usr/bin/env bash
# Structural check for the haiku-split skill. Usage: bash check.sh [skill-dir]
set -u
DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
need_file() { [ -f "$DIR/$1" ] || fail "missing file $1"; }
need_str() { grep -qF -- "$2" "$DIR/$1" 2>/dev/null || fail "$1 lacks: $2"; }

for f in SKILL.md templates/TASKS.md templates/handoff.md templates/hard-rules.md templates/workflow.js.tmpl; do
  need_file "$f"
done

# Frontmatter
need_str SKILL.md "name: haiku-split"
need_str SKILL.md "description:"
need_str SKILL.md "claude-haiku-4-5-20251001"
need_str SKILL.md "Confirm"
need_str SKILL.md "classify"

# Script template: model pinned, constants, barrier procedure, no forbidden APIs
T=templates/workflow.js.tmpl
need_str $T "claude-haiku-4-5-20251001"
for s in "{{LIMIT}}" "{{MAX_SEGMENTS}}" "{{AREA}}" "{{RUN_DIR}}" "{{PARAMS}}" "{{HARD_RULES}}" \
         startCounter endCounter handoffPath avenuesCovered avenuesRemaining left_area blocked handoff \
         "args.startSegment" "export const meta"; do
  need_str $T "$s"
done
if grep -qE 'Date\.now|Math\.random|new Date\(\)' "$DIR/$T" 2>/dev/null; then fail "$T uses a forbidden API"; fi

# Hard rules + handoff + tasks templates
need_str templates/hard-rules.md "No outbound email"
need_str templates/hard-rules.md "blocked"
for s in "Done" "Remains" "state" "Gotchas" "Side effects" "Findings"; do need_str templates/handoff.md "$s"; done
for s in "Depends on" "Done-check" "Source step" "Est tokens"; do need_str templates/TASKS.md "$s"; done

# Rendered script must parse as JS (wrapped, because the script body uses top-level return)
if [ -f "$DIR/$T" ]; then
  TMP="$(mktemp -d)"
  sed -e 's/{{LIMIT}}/100000/g' -e 's/{{MAX_SEGMENTS}}/5/g' \
      -e 's/{{AREA}}/"demo"/g' -e 's/{{RUN_DIR}}/"\/tmp\/run"/g' \
      -e 's/{{PARAMS}}/"none"/g' -e 's/{{HARD_RULES}}/"- rule"/g' \
      "$DIR/$T" | sed 's/^export const meta/const meta/' > "$TMP/body.js"
  { echo "(async () => {"; cat "$TMP/body.js"; echo "})()"; } > "$TMP/wrapped.js"
  node --check "$TMP/wrapped.js" 2>"$TMP/err" || { fail "rendered workflow.js does not parse"; cat "$TMP/err"; }
  rm -rf "$TMP"
fi

[ "$FAIL" -eq 0 ] && echo "OK: haiku-split structure valid" && exit 0
exit 1
````

- [ ] **Step 2: Run it to verify it fails**

Run: `bash Projects/claude-skills/haiku-split/tests/check.sh`
Expected: exit 1 with `FAIL: missing file SKILL.md` and the template files.

---

### Task 3: Templates — hard rules, handoff, task spec

**Files:**
- Create: `Projects/claude-skills/haiku-split/templates/hard-rules.md`
- Create: `Projects/claude-skills/haiku-split/templates/handoff.md`
- Create: `Projects/claude-skills/haiku-split/templates/TASKS.md`

**Interfaces:**
- Produces: `hard-rules.md` is read by the skill and rendered into `{{HARD_RULES}}` (rule 11). `handoff.md` is the structure segments write (rule 4) and the source of `handoff-0.md` (rule 5). `TASKS.md` is the block structure the skill fills per run.

- [ ] **Step 1: Write `hard-rules.md`**

```markdown
- No outbound email, SMS, chat messages or any other outbound communication.
- Test data only. Never touch real or production data.
- Do not restart, stop or reconfigure any service.
- Write only to the outputs declared in your task and to this run folder.
- Do not spawn subagents. Do not invoke skills.
- Never ask the user a question. If you need a decision or a parameter that is not pre-answered, return status "blocked" with the question in `summary`.
- Do not read files your task does not list under Inputs, and never read project source unless your task lists it.
- Browser tasks only: restore the viewport size before finishing.
```

- [ ] **Step 2: Write `handoff.md`**

```markdown
# Handoff <n> — AREA=<area>

## Done
<task ids finished and their result, one line each>

## Remains
<task ids not yet done, in order; the next one first>

## Current state
<exact file, page or dialog state: what is open, what is half-written, the last command run and its result>

## Gotchas
<quirks hit so far that the next segment must know>

## Side effects
<files created, rows written, services touched, or "none">

## Findings so far
<one line each; also appended to notes.md>
```

- [ ] **Step 3: Write `TASKS.md`**

````markdown
# Task spec — <target skill> — AREA=<area>

- Run folder: <path>
- LIMIT: <tokens> · MAX_SEGMENTS: <n> · Task target: <tokens>
- Pre-answered parameters: <list, or none>

## Hard rules
<contents of hard-rules.md, with any non-applicable line removed>

## Tasks (run in order)

### T1 — <title>
- Source step: <target skill section/step>
- Class: haiku
- Depends on: none
- Inputs: <exact paths / prior task outputs>
- Instructions: <self-contained, the target skill's wording inlined>
- Outputs: <exact paths / notes.md entries>
- Done-check: <mechanical command or condition>
- Est tokens: <n>
- Side effects: <files, rows, or none>

### P1 — <title> (pause)
- Source step: <target skill section/step>
- Class: pause
- Reason: <why the user must decide>
- Main session must: <what to do or ask, then append `DONE-MAIN P1` to progress.log>

### M1 — <title> (main)
- Source step: <target skill section/step>
- Class: main
- Reason: <judgment or scoring that stays with the main session>
- Main session must: <what to do, then append `DONE-MAIN M1` to progress.log>
````

- [ ] **Step 4: Verify the three files exist and carry their required words**

Run: `bash Projects/claude-skills/haiku-split/tests/check.sh 2>&1 | grep -E "hard-rules|handoff.md|TASKS.md"`
Expected: no `FAIL` lines mentioning those three files (other FAILs for `SKILL.md` and `workflow.js.tmpl` remain).

---

### Task 4: Workflow script template

**Files:**
- Create: `Projects/claude-skills/haiku-split/templates/workflow.js.tmpl`

**Interfaces:**
- Consumes: tokens `{{LIMIT}}` (number), `{{MAX_SEGMENTS}}` (number), and JSON string literals `{{AREA}}`, `{{RUN_DIR}}`, `{{PARAMS}}`, `{{HARD_RULES}}` (each substituted including its quotes, e.g. `"C:/x/run"`).
- Consumes: Workflow `args.startSegment` (optional integer, default 1).
- Produces: returns `{ segments, last, results }` where each result matches the segment schema.

- [ ] **Step 1: Write the template**

````javascript
export const meta = {
  name: 'haiku-split-run',
  description: 'Run haiku-split tasks as chained Haiku segments under the context-barrier rules',
  phases: [{ title: 'Segments', detail: 'sequential Haiku segments, one handoff file per segment' }],
}

const HAIKU = 'claude-haiku-4-5-20251001'
const LIMIT = {{LIMIT}}
const MAX_SEGMENTS = {{MAX_SEGMENTS}}
const AREA = {{AREA}}
const RUN_DIR = {{RUN_DIR}}
const PARAMS = {{PARAMS}}
const HARD_RULES = {{HARD_RULES}}
const START = (args && args.startSegment) || 1

const SEGMENT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['handoff', 'done', 'left_area', 'blocked'] },
    startCounter: { type: 'number' },
    endCounter: { type: 'number' },
    handoffPath: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    avenuesCovered: { type: 'array', items: { type: 'string' } },
    avenuesRemaining: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['status', 'startCounter', 'endCounter', 'handoffPath', 'findings', 'avenuesCovered', 'avenuesRemaining', 'summary'],
}

function segmentPrompt(n) {
  const prev = `${RUN_DIR}/handoff-${n - 1}.md`
  const mine = `${RUN_DIR}/handoff-${n}.md`
  return `You are segment ${n} of a chained Haiku workflow. AREA=${AREA}.
You cannot ask the user anything. If you need a decision or a parameter that is not pre-answered below, return status "blocked" and put the question in summary.

HARD RULES (every segment):
${HARD_RULES}

PRE-ANSWERED PARAMETERS:
${PARAMS}

FILES (all under ${RUN_DIR}):
- TASKS.md: the full ordered task list.
- ${prev}: READ THIS FIRST. It says what is done, what remains and the exact state. (handoff-0.md is the seed written before the run.)
- notes.md: shared findings. Read it. Append each finding to it AS YOU GO, not only at the end.
- progress.log: read it. Append one line after EVERY action.

WHAT TO DO:
Work the tasks in TASKS.md in order. A task is already done if progress.log has a line containing "DONE <id>" or "DONE-MAIN <id>" for it. Do not repeat covered work.
For each task: do its Instructions exactly, write its Outputs, then run its Done-check. If the check passes, append "... | DONE <id> - <result>". If it fails, append "... | FAILED <id> - <why>" and add a finding.
If the next task is a P (pause) or M (main) block, or depends on a FAILED task, stop and return status "blocked" with the reason in summary.
If you are about to do something outside AREA=${AREA}, do not do it: append "... | stopped - leaving area", and return status "left_area".
When every task is done or marked DONE-MAIN, return status "done".

PROGRESS LOG LINE FORMAT (append with a shell redirect, one line each):
AREA=${AREA} | seg ${n} | used=<N> | <action and result>
Also write "HANDOFF ..." when you hand off and "DONE ..." when the whole run is done.

CONTEXT BARRIER (hard):
1. Your FIRST "<total_tokens>N tokens left" value in this conversation is startCounter. After EVERY tool call, compute used = startCounter - current N.
2. LIMIT is ${LIMIT} tokens. When used >= ${LIMIT}: finish only the action in flight, write ${mine}, append a HANDOFF line, return status "handoff".
3. ${mine} must hold these headings: Done, Remains, Current state (exact file/page/dialog state), Gotchas, Side effects, Findings so far.
4. If you cannot see any "<total_tokens>" value, return status "blocked" with summary "token counter not visible" before doing any task.

SMALL READS: write snapshots or long output to a file and grep it. No screenshots unless the task needs one; keep at most 2-4 clean ones.

RETURN (structured): status (handoff | done | left_area | blocked), startCounter, endCounter, handoffPath (${mine}), findings[], avenuesCovered[] (task ids done), avenuesRemaining[] (task ids not done), summary.`
}

phase('Segments')
const results = []
let last = null
for (let n = START; n < START + MAX_SEGMENTS; n++) {
  const r = await agent(segmentPrompt(n), {
    label: `segment ${n}`,
    phase: 'Segments',
    model: HAIKU,
    schema: SEGMENT_SCHEMA,
  })
  results.push(r)
  if (r === null) {
    log(`segment ${n} -> null | stopped`)
    last = { status: 'null' }
    break
  }
  const used = (r.startCounter || 0) - (r.endCounter || 0)
  log(`segment ${n} -> ${r.status} | used ~${Math.round(used / 1000)}k | ${r.findings.length} findings`)
  last = r
  if (r.status !== 'handoff') break
}
if (last && last.status === 'handoff') {
  log(`MAX_SEGMENTS (${MAX_SEGMENTS}) reached. avenuesRemaining: ${JSON.stringify(last.avenuesRemaining)}`)
}
return { segments: results.length, last, results }
````

- [ ] **Step 2: Run the check; the workflow-template assertions must now pass**

Run: `bash Projects/claude-skills/haiku-split/tests/check.sh 2>&1 | grep -E "workflow.js|parse|forbidden"`
Expected: no output (no FAIL lines for the template or the parse step). `SKILL.md` FAILs remain.

---

### Task 5: The skill — `SKILL.md`

**Files:**
- Create: `Projects/claude-skills/haiku-split/SKILL.md`

**Interfaces:**
- Consumes: `templates/TASKS.md`, `templates/handoff.md`, `templates/hard-rules.md`, `templates/workflow.js.tmpl` (paths below use `~/.claude/skills/haiku-split/templates/`, the installed location).
- Produces: `/haiku-split <skill> [--limit N] [--task-size N] [--max-segments N] [--args "..."]`.

- [ ] **Step 1: Write `SKILL.md`**

````markdown
---
name: haiku-split
description: >
  Take any skill in ~/.claude/skills and split all of its steps into Haiku-sized tasks, then run
  them as a chained, context-capped Haiku Workflow with handoff files. Writes a task spec and a
  workflow script to a run folder and launches only after you confirm that run. Judgment and
  approval steps stay with the main session. Triggered by /haiku-split.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Workflow
---

# haiku-split

## Constraint — read this first

**This skill is the one place where subagents are launched, and only after the user confirms that
specific run (§6).** The confirmation covers that one run, never a later run or another skill; a
resume after a pause (§8) is a new run and is confirmed again. Every Haiku segment follows the
context-barrier rules encoded in `workflow.js.tmpl` and the hard-rules block. The skill itself
never reads project source code and never edits the target skill.

Usage:
  `/haiku-split <skill-name | path> [--limit <tokens>] [--task-size <tokens>] [--max-segments <n>] [--args "<args for the target skill>"]`

Defaults: `--limit 100000`, `--task-size 20000`, `--max-segments 10`.
Haiku model ID is exactly `claude-haiku-4-5-20251001`. It is set explicitly on every `agent()` call:
an omitted model inherits the controller's model and breaks the Haiku bound.

## 1 — Resolve

1. `<skill-name>` resolves to `~/.claude/skills/<skill-name>/SKILL.md`. If the argument contains a
   path separator or ends in `SKILL.md`, use it as that path.
2. If nothing resolves: Glob `~/.claude/skills/*/SKILL.md`, list the names, and stop.
3. If the target is `haiku-split` itself, refuse and stop.
4. Read the target `SKILL.md` and every `_shared` or reference file it names. Read no project source.
5. Name the single scope **AREA**: `<skill-name>` plus the `--args` value, e.g. `plan-feature:ADO-123`.
6. Run folder: `<cwd>/.claude/haiku-split/<skill-name>/<YYYYMMDD-HHMM>/`. Create it.

## 2 — Classify every step

Walk the target skill step by step. Label each step exactly one of:

- **haiku** — mechanical, bounded and verifiable: reading named files, grep/glob, running a command
  and recording its output, writing a templated file, transcription, applying a fully specified edit.
- **main** — judgment, scoring, design, security or risk calls, anything gated by the target's model
  tier. Stays with the main session.
- **pause** — a hard pause, an approval, or a question to the user.

If a `haiku` step cannot be given a mechanical done-check, relabel it `main`.
If no step is `haiku`, report that, show the classification, and stop. Do not generate a workflow.

## 3 — Split into tasks

Cut `haiku` steps into tasks of at most `--task-size` tokens (estimate: reading a file about 1 token
per 4 characters, plus output, plus about 3k overhead). Rules:

- A task inlines the target skill's wording. A segment never invokes the target skill and has no
  model gate.
- Every task has: Source step, Class, Depends on, Inputs, Instructions, Outputs, Done-check,
  Est tokens, Side effects (the `templates/TASKS.md` block).
- `Depends on` lists every earlier task whose Outputs this task reads.
- `main` and `pause` steps become `M<n>` / `P<n>` blocks in their original position.
- Collect every question a segment might ask (confirmations, parameters) and answer them now
  by asking the user once (AskUserQuestion). These become the pre-answered parameters.

## 4 — Write the run folder

Write into the run folder:

1. `TASKS.md` from `~/.claude/skills/haiku-split/templates/TASKS.md`: header, hard rules (from
   `templates/hard-rules.md`, deleting any line that cannot apply, e.g. the browser line), tasks.
2. `handoff-0.md` from `templates/handoff.md`: Done = none, Remains = all task ids in order,
   Current state = "not started", Gotchas from your reading of the target, Side effects = none.
3. `notes.md`: `# Findings — AREA=<area>`, empty body.
4. `progress.log`: empty file.
5. `workflow.js` from `templates/workflow.js.tmpl`, substituting:
   `{{LIMIT}}`, `{{MAX_SEGMENTS}}` as bare numbers; `{{AREA}}`, `{{RUN_DIR}}`, `{{PARAMS}}`,
   `{{HARD_RULES}}` as JSON string literals including quotes (escape newlines as `\n`).
   Use forward slashes in `{{RUN_DIR}}`.

Then check the script parses: wrap it as `(async () => { ... })()` with `export const meta`
changed to `const meta`, and run `node --check` on it. Fix and retry until it passes.

## 5 — Show the plan

Report in a short table: counts of haiku / main / pause tasks, estimated segments
(`ceil(total est tokens / --limit)`), AREA, LIMIT, MAX_SEGMENTS, the run folder, and the first
`main`/`pause` block that will stop the run. Do not paste the files.

## 6 — Confirm the launch (hard pause)

Ask with AskUserQuestion: "Launch N Haiku segments for <skill> now? This starts subagents on
claude-haiku-4-5-20251001, capped at <LIMIT> tokens each." Options: Launch / Don't launch.
On anything but Launch, stop and leave the files in place. The yes covers this run only.

## 7 — Launch

Call Workflow with `scriptPath` = the run folder's `workflow.js` (no `name`). Then wait for the
completion notification. Read `progress.log` and `notes.md` only after it arrives.

## 8 — Pauses and resume

The workflow returns `blocked` when the next task is a `P`/`M` block, depends on a FAILED task,
or the counter was not visible. For each case:

- `P`/`M` block: do it yourself (or ask the user), then append
  `AREA=<area> | main | DONE-MAIN <id> - <result>` to `progress.log`.
- FAILED dependency: report the failure and ask the user how to proceed.
- Counter not visible: report that the barrier cannot fire and stop; do not relaunch.

To continue, repeat §6 (confirm again), then call Workflow with the same `scriptPath` and
`args: { startSegment: <last segment number + 1> }`.

## 9 — Final review

When the workflow returns `done`: read `notes.md`, `progress.log` and the produced files. Check each
FAILED line and each Outputs path from `TASKS.md` exists. Report using the global response format.
Anything you cannot verify, say so.

## Rules

- Never launch without the §6 confirmation.
- Never run a segment on a model other than `claude-haiku-4-5-20251001`.
- No automatic escalation to a larger model. A failed or ambiguous task goes to the main session.
- Segments run sequentially, never in parallel.
- Never modify the target skill or any file under `~/.claude/skills` other than this skill's own.
````

- [ ] **Step 2: Run the check**

Run: `bash Projects/claude-skills/haiku-split/tests/check.sh`
Expected: `OK: haiku-split structure valid` and exit 0.

- [ ] **Step 3: Read the file once for placeholder text**

Run: `grep -nE "TBD|TODO|fill in" Projects/claude-skills/haiku-split/SKILL.md Projects/claude-skills/haiku-split/templates/*`
Expected: no output.

---

### Task 6: Dry run on a real skill (no launch)

**Files:**
- Creates (run folder, under the cwd): `.claude/haiku-split/kevin/<timestamp>/`

**Interfaces:**
- Consumes: the skill from Task 5 loaded from the repo copy.

- [ ] **Step 1: Load the skill from the repo copy and run it on `kevin`**

Follow `Projects/claude-skills/haiku-split/SKILL.md` §1-§5 by hand against `~/.claude/skills/kevin/SKILL.md` with `--max-segments 3`.
Expected: `TASKS.md`, `handoff-0.md`, `notes.md`, `progress.log`, `workflow.js` exist in the run folder; `node --check` passes; the §5 table shows at least one `main` or `pause` block (kevin has hard pauses).

- [ ] **Step 2: Stop at §6 and answer "Don't launch"**

Expected: no Workflow call is made; files stay in place.

- [ ] **Step 3: Inspect the output**

Check by eye: every task has a Done-check that is a command or condition (not "looks right"); no task says "see the skill"; every `Depends on` names real earlier task ids. Fix `SKILL.md` §2/§3 wording and re-run if any fails.

---

### Task 7: Install and document

**Files:**
- Create: `~/.claude/skills/haiku-split/` (copy of `Projects/claude-skills/haiku-split/`)
- Modify: `~/.claude/CLAUDE.md` (subagent carve-out)
- Modify: `Projects/claude-skills/README.md` (table row, install line, no-subagents note)

**Interfaces:**
- Each edit outside the project needs explicit user approval at that moment. Ask directly; do not route around a block.

- [ ] **Step 1: Ask the user to approve the install, then copy**

Run: `cp -r Projects/claude-skills/haiku-split ~/.claude/skills/haiku-split`
Run: `bash ~/.claude/skills/haiku-split/tests/check.sh`
Expected: `OK: haiku-split structure valid`.

- [ ] **Step 2: Ask the user to approve the CLAUDE.md carve-out, then add one paragraph after the "The one exception" paragraph in "Subagents — never built in, only ad hoc"**

```
`/haiku-split` is a second, narrow exception: the user running it and confirming the launch prompt
(§6 of that skill) counts as the ad hoc request for that one run only. The confirmation never
carries to another run, a resume, or another skill, and every segment it launches must obey the
context-barrier rules above.
```

- [ ] **Step 3: Update `Projects/claude-skills/README.md`**

Add a row to the skills table:

```
| **`/haiku-split`** | Splits any skill's steps into Haiku-sized tasks and runs them as a chained, context-capped Haiku Workflow with handoff files. Launches only after you confirm each run; judgment and approval steps stay with the main session. | a run folder (task spec + workflow script + notes) |
```

Add `haiku-split` to the `cp -r` install line, and replace the heading "Note — no subagents, by design" paragraph's first sentence with: "None of these skills dispatch subagents except `/haiku-split`, which launches Haiku segments only after you confirm each run."

- [ ] **Step 4: Commit (only if the user says so)**

```bash
cd Projects/claude-skills
git add haiku-split docs README.md
git commit -m "feat: add haiku-split skill"
```

---

### Task 8: Smoke test the real launch

**Files:**
- Create: `<scratchpad>/smoke/SKILL.md` (throwaway fixture target)

**Interfaces:**
- Consumes: the installed skill. Verifies spec §11 assumptions.

- [ ] **Step 1: Create the fixture skill**

````markdown
---
name: smoke-fixture
description: Throwaway fixture for haiku-split smoke test
---

# smoke-fixture

1. Write a file `out/a.txt` containing the line `alpha`.
2. Write a file `out/b.txt` containing the line `beta`.
3. Count the lines across `out/a.txt` and `out/b.txt` and write the number to `out/count.txt`.
4. Ask the user to approve the result before finishing.
5. Write `out/final.txt` containing `approved`.
````

- [ ] **Step 2: Run `/haiku-split <scratchpad>/smoke/SKILL.md --limit 25000 --task-size 4000 --max-segments 3` and confirm Launch**

Expected: step 4 becomes a `P1` block; the workflow runs T1-T3, returns `blocked` at P1 (or `handoff` first if the low limit trips).

- [ ] **Step 3: Verify the three assumptions**

- Counter visible: `progress.log` lines carry numeric `used=` values, and no segment returned `blocked` with "token counter not visible".
- Handoff fires: if a segment returned `handoff`, `handoff-<n>.md` has all six headings.
- Haiku bound: the Workflow progress display shows `claude-haiku-4-5-20251001` for every segment.
Expected: all three hold. If counter is not visible, record that in spec §11 and stop; the barrier rules 2-3 need a different measure.

- [ ] **Step 4: Resume**

Append `DONE-MAIN P1` to `progress.log`, confirm the launch prompt again, relaunch with `args: { startSegment: <last + 1> }`.
Expected: segment runs T5 only, writes `out/final.txt`, returns `done`; earlier `handoff-<n>.md` files are unchanged.

- [ ] **Step 5: Record the result in the spec**

Add one line under spec §11: `Smoke test 2026-10-06: <pass | fail + what>`.

- [ ] **Step 6: Clean up**

Delete the fixture and its `out/` folder (look at the target path first).

---

## Self-review

- **Spec coverage:** D1 → SKILL.md Constraint, §6, §8; D2 → §4; D3 → §2, §8, `P`/`M` blocks and prompt; D4 → defaults and §3; D5 → TASKS.md Done-check and §9; D6 → Task 7; D7 → Global Constraints and Task 7 (README only). Barrier rules 1-14 → `workflow.js.tmpl` prompt plus loop; rule 11 → `hard-rules.md`; rule 13 → §6; rule 14 → §3 parameter collection. Spec §10 docs → Task 7. Spec §11 assumptions → Task 8.
- **Placeholder scan:** the only `{{TOKENS}}` and `<angle>` text are in templates, where substitution is the design.
- **Type consistency:** `startSegment`, `SEGMENT_SCHEMA` fields, status values, `DONE`/`DONE-MAIN`/`FAILED` markers and file names (`handoff-<n>.md`, `notes.md`, `progress.log`, `TASKS.md`, `workflow.js`) are the same in the template, SKILL.md and check script.
