---
name: pigeon
description: >
  Runs one feature end-to-end through ten fixed personas in a single continuous session, chained
  via handoff documents that each persona writes, naming the next persona to pick it up. Several
  personas invoke an existing pipeline skill (plan-feature, execute-plan, test-feature, kevin,
  security-review, simplify, cleanup-crew) as their substantive step rather than reinventing it.
  Hard-pauses at the business aligner's cost/timeline checkpoint, any backward hop, and the
  cybersecurity expert's findings. Triggered by /pigeon.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion
---

# pigeon

## Constraint — read this first

**No persona invoked by this skill ever spawns a subagent** — see
`~/.claude/skills/_shared/pipeline-contract.md` "No subagents, anywhere". Every persona switch is
this session adopting new operating instructions and writing/reading a file, never a dispatch.
This skill reads `_shared/pipeline-contract.md` for repo resolution, `<Name>` derivation, the
telegraph convention and cost discipline, and `_shared/complexity-scoring.md` is never consulted
directly — every model-tier gate below belongs to whichever skill a persona invokes.

Usage:
  `/pigeon "<task description>" [--name <Name>]`
  `/pigeon --resume <Name>`

## 0 — Resolve

1. Resolve the target repo by walking up to the nearest `.git`, per `pipeline-contract.md` "Repo
   resolution". If there is none, say so plainly and stop.
2. Derive `<Name>` exactly per `pipeline-contract.md` "Name derivation" (ADO id, or a kebab-case
   slug of the task description); `--name` overrides it.
3. Run folder: `.claude/pigeon/<Name>/`. Create it if absent.
4. Fresh start (no `--resume`): current persona = `task-researcher`, input = the raw task
   description.
   `--resume <Name>`: read `RUN_LOG.md`'s last row and the highest-numbered handoff file in the
   run folder; current persona = that handoff's `Next:` persona.

## 1 — Persona registry

| # | Persona-id | File | Role |
|---|---|---|---|
| 1 | `task-researcher` | `personas/01-task-researcher.md` | entry point; defines the problem |
| 2 | `business-aligner` | `personas/02-business-aligner.md` | locates it, runs `plan-feature`, cost/timeline checkpoint |
| 3 | `ui-designer` | `personas/03-ui-designer.md` | designs new UI — conditional, skipped when no frontend surface |
| 4 | `software-developer` | `personas/04-software-developer.md` | runs `execute-plan` |
| 5 | `test-engineer` | `personas/05-test-engineer.md` | runs `test-feature`, `kevin`, Docker load-test verification |
| 6 | `cybersecurity-expert` | `personas/06-cybersecurity-expert.md` | runs `security-review` |
| 7 | `refactor-developer` | `personas/07-refactor-developer.md` | runs `simplify` |
| 8 | `infrastructure-specialist` | `personas/08-infrastructure-specialist.md` | lists CI/CD requirements, never executes them |
| 9 | `release-notes-writer` | `personas/09-release-notes-writer.md` | client-facing summary |
| 10 | `ship` | `personas/10-ship.md` | runs `cleanup-crew`; terminal |

## 2 — The hop loop

Repeat until a handoff's `Next:` is `"none — run complete"`:

1. **Telegraph** one line naming the persona about to run (`pipeline-contract.md`'s telegraph
   convention).
2. Load `personas/<NN>-<id>.md` for the current persona and adopt its instructions exactly.
3. Give it the latest handoff doc (or the raw task description, on hop 1) plus whatever durable
   artifact paths that handoff points to.
4. Execute it. It produces its substantive output and writes a new handoff file in the run
   folder, numbered the next integer in call order (never reusing or overwriting a number),
   using `templates/handoff.md`. Append one row to `RUN_LOG.md`.
5. Read the new handoff's `Next:` field.
   - `"none — run complete"` → exit the loop, go to §5 (cleanup).
   - Otherwise, classify the hop: **forward** if the named persona sits strictly later in the
     §1 table than the current one, **backward** otherwise (same or earlier).
6. **Hard pause** — stop and show the user the handoff before continuing, when any of:
   - the hop is backward;
   - the current persona is `business-aligner` (its checkpoint always pauses, even forward);
   - the current persona is `cybersecurity-expert` (always pauses, regardless of direction).
   On anything but "continue", stop and leave the run folder as-is.
7. **Loop-safety (bounce cap):** before continuing, count consecutive hops in `RUN_LOG.md` that
   landed back on the same persona-id without an intervening forward hop past it. If this
   exceeds 3, pause and ask the user how to proceed instead of continuing automatically — do not
   cycle indefinitely.
8. Set current persona = the named `Next:` persona and go to step 1.

## 3 — Conditional skip: `ui-designer`

The skip decision is `business-aligner`'s own (persona 2's file), not a second check here: it
reads the plan's File Impact Manifest (from the `plan-feature` run it just did) and routes `Next:`
straight to `software-developer` when no touched file matches a recognizable UI path/extension,
noting the skip in its `Reason:` line. `pigeon` adds no separate detection logic.

## 4 — `--resume`

A resumed hop is confirmed exactly like a fresh backward hop (§2 step 6) when the resume target
sits at or before where the run paused — never silently resumed forward. The bounce cap (§2 step
7) counts across a resume exactly as it does within one continuous run; `RUN_LOG.md` is the
record, not session memory.

## 5 — Cleanup on completion

When a handoff's `Next:` is `"none — run complete"` (only ever written by `ship`): telegraph one
line that cleanup is starting (not a pause — this is tidying the run's own already-done scratch
files, not a forward-progress decision), then delete every numbered handoff file in the run
folder, keeping only `RUN_LOG.md`.

## Rules

- Never spawn a subagent, anywhere in this skill.
- Every persona's model tier is inherited from whichever skill it invokes; this skill adds no
  gate of its own.
- Handoff numbering is call order, never persona order; a file is never overwritten.
- The test engineer's Docker requirement (persona 5) is enforced in that persona's own file, not
  here — this skill does not pre-check for Docker.
