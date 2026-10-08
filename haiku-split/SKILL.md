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

Walk the target skill step by step and classify each step. Label each step exactly one of:

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
   Use forward slashes in `{{RUN_DIR}}`. Render with Node so strings are escaped correctly
   (`node -e` has no script slot, so arguments start at `process.argv.slice(1)`):

   ```bash
   node -e 'const fs=require("fs");const [t,out]=process.argv.slice(1);
   const m={LIMIT:"100000",MAX_SEGMENTS:"10",AREA:JSON.stringify("<area>"),RUN_DIR:JSON.stringify("<run folder>"),
   PARAMS:JSON.stringify("<params>"),HARD_RULES:JSON.stringify("<rules text>")};
   let s=fs.readFileSync(t,"utf8");for(const k in m)s=s.split("{{"+k+"}}").join(m[k]);fs.writeFileSync(out,s)' \
   ~/.claude/skills/haiku-split/templates/workflow.js.tmpl <run folder>/workflow.js
   ```

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
