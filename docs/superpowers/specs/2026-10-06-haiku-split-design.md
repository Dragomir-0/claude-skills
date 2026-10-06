# haiku-split — design

Date: 2026-10-06 · Status: draft for review

## 1. Purpose

`/haiku-split <skill-name>` takes any skill in `claude-skills` and turns its steps into a set of
Haiku-sized tasks, plus a Workflow script that runs them as chained Haiku segments under the
context-barrier rules (14 rules, now in `~/.claude/CLAUDE.md`). It is a standalone wrapper: it
reads the target skill, writes its own artifacts, and edits no existing skill or pipeline contract.

## 2. Decisions (agreed 2026-10-06)

| # | Decision |
|---|---|
| D1 | Subagent policy: the user confirms **each run** before launch. Confirmation covers that one run only and never carries to another run or skill. Every segment obeys the 14 barrier rules. |
| D2 | Output: a task spec (markdown, reviewable) **and** a ready-to-run Workflow script. |
| D3 | Hard pauses / approvals / judgment steps in the target skill: the workflow **stops** there and returns `blocked` with a summary; the user resumes. Judgment-heavy steps stay with the main session, not Haiku. |
| D4 | Sizing: segment `LIMIT` = 100k tokens, task target ≈ 20k or less. Both overridable per run. |
| D5 | Verification: every task carries a mechanical done-check; the main session does one final review of merged findings and files. |
| D6 | Name/location: `haiku-split`, in `~/.claude/skills/haiku-split/` and mirrored (file copy + commit) to `Projects/claude-skills/haiku-split/`. |
| D7 | Standalone: does not register with `pipeline-contract.md` and does not change `execute-plan` or any other skill. |

## 3. Invocation

```
/haiku-split <skill-name> [--limit <tokens>] [--task-size <tokens>] [--max-segments <n>] [--args "<args for the target skill>"]
```

`<skill-name>` resolves to `~/.claude/skills/<skill-name>/SKILL.md`. If the argument contains a
path separator or ends in `SKILL.md`, it is used as that path instead (this is how the smoke test
points at a fixture). If nothing resolves, stop and list the available skills. `haiku-split`
cannot target itself.

## 4. Flow

1. **Resolve.** Read the target `SKILL.md` and every `_shared` or reference file it names. Read no
   source code from any project.
2. **Classify each step** of the target skill as one of:
   - `haiku` — mechanical, bounded, verifiable: file reads, greps, templated writes, transcription,
     running a command and recording output, applying a fully specified edit.
   - `main` — judgment, scoring, design decisions, security/risk calls, anything needing the
     skill's model gate. Left for the main session.
   - `pause` — a hard pause, approval, or question to the user. Becomes a workflow stop (D3).
3. **Split** `haiku` steps into tasks of about 20k tokens or less (D4). A step that cannot be made
   verifiable is reclassified `main`.
4. **Write the task spec** (section 5) to the run folder.
5. **Generate the Workflow script** (section 6) to the run folder.
6. **Show the user** the spec summary: counts of `haiku`, `main`, `pause`, estimated segments, and
   the scope area. Ask for confirmation to launch (D1). On a no, stop with the files left in place.
7. **Launch** via the `Workflow` tool only after a yes.
8. **Resume at pauses.** When the workflow returns `blocked` at a `pause`/`main` step, the main
   session does that step or gets the user's answer and appends `DONE-MAIN <id>` to
   `progress.log`. It then launches a fresh run of the same `workflow.js` with
   `args: { startSegment: <last segment + 1> }` after the user confirms (D1 applies to every
   launch, including resumes). Segment numbering continues, so handoff files are never overwritten.
9. **Final review** (D5): read the shared notes, the progress log and the produced files; report.

## 5. Task spec format

File: `<run-folder>/TASKS.md`. One block per task:

```
### T<n> — <title>
- Source step: <target skill section/step>
- Class: haiku
- Depends on: <task ids, or none>
- Inputs: <exact file paths / prior task outputs>
- Instructions: <self-contained; the target skill's wording inlined, never "go read the skill">
- Outputs: <exact file paths / notes-file entries>
- Done-check: <mechanical command or condition: file exists, grep matches, test exits 0>
- Est tokens: <n>
- Side effects: <files created, rows written, or none>
```

Segments never invoke the target skill themselves. The relevant instructions are inlined into the
task so the segment needs no skill, no model gate and no question to the user.

`pause` and `main` steps appear as `### P<n>` / `### M<n>` blocks with the reason and what the
main session must do. Header carries the scope area (rule 8), `LIMIT`, `MAX_SEGMENTS`, and the
hard-rules block (rule 11).

## 6. Workflow script

Generated per run, written to `<run-folder>/workflow.js`, run by the `Workflow` tool.

- Every `agent()` call sets `model: 'claude-haiku-4-5-20251001'` explicitly. An omitted model
  inherits the controller's model and breaks the Haiku bound.
- Constants `LIMIT`, `MAX_SEGMENTS` at the top (rule 1).
- Chain loop is sequential and continues only while `status === 'handoff'`; it stops on null,
  `done`, `left_area` or `blocked`; it logs `segment N -> status | used ~Nk | findings`; after
  `MAX_SEGMENTS` it logs `avenuesRemaining` (rule 7).
- Segment return schema: `status (handoff | done | left_area | blocked)`, `startCounter`,
  `endCounter`, `handoffPath`, `findings[]`, `avenuesCovered[]`, `avenuesRemaining[]`, `summary`
  (rule 6).
- Each segment prompt contains: its task slice, the scope fence, the hard-rules block, the paths to
  the seed/previous handoff, notes file and progress log, the barrier procedure (rules 2-4, 9, 12),
  and every pre-answered confirmation or parameter (rule 14).

### Barrier-rule coverage

| Rule | Where it lives |
|---|---|
| 1 cap constants | script header |
| 2 measure usage | segment prompt: record first `<total_tokens>` as `startCounter`, check after every tool call |
| 3 hard stop | segment prompt: at `used >= LIMIT` finish the action in flight, write handoff, return `handoff` |
| 4 handoff contents | segment prompt + handoff template in the skill |
| 5 seed and chained reads | `handoff-0.md` generated by the skill; later segments read previous handoff, notes, progress log |
| 6 return schema | script `schema:` option |
| 7 chain loop | script body |
| 8 scope fence | task spec header + segment prompt; `left_area` return |
| 9 progress log | segment prompt: one line per action, plus `HANDOFF`/`DONE` lines |
| 10 small reads | segment prompt |
| 11 hard rules block | generated once, repeated in every segment prompt |
| 12 findings append | segment prompt: append to notes as it goes |
| 13 subagents ad hoc | D1: user confirms each run |
| 14 pre-answer questions | skill collects parameters before launch and inlines them |

## 7. Run folder

`<cwd>/.claude/haiku-split/<skill-name>/<YYYYMMDD-HHMM>/` containing `TASKS.md`, `workflow.js`,
`handoff-0.md`, `handoff-<n>.md`, `notes.md`, `progress.log`. Nothing is written outside it except
what a task's declared outputs say.

## 8. Failure handling

- A segment returns null or `blocked`: the chain stops; the main session reads the last handoff and
  progress log, reports, and asks the user what to do.
- A done-check fails: the task is marked failed in the notes. The chain continues only if later
  tasks do not depend on it; otherwise it stops with `blocked`.
- No automatic escalation to a bigger model. A failed or ambiguous task goes to the main session.

## 9. Files to create

```
~/.claude/skills/haiku-split/SKILL.md        # the skill (frontmatter + flow above)
~/.claude/skills/haiku-split/templates/      # TASKS.md, handoff.md, hard-rules.md, workflow.js.tmpl
```

Mirrored to `Projects/claude-skills/haiku-split/` by file copy and commit (no `git pull`).

## 10. Documentation changes

1. `~/.claude/CLAUDE.md`: add a narrow carve-out to "Subagents — never built in, only ad hoc":
   a user-confirmed `/haiku-split` launch counts as the ad hoc request for that one run only.
2. `claude-skills/README.md`: add a `haiku-split` row and amend the "no subagents, by design" note
   to say `haiku-split` is the one skill that launches subagents, and only after per-run
   confirmation.
3. `_shared/pipeline-contract.md` is **not** edited (D7). The README note covers the exception.

Each edit outside the project needs the user's explicit approval at the time.

## 11. Assumptions to verify in a smoke test

- A Workflow-spawned subagent sees the `<total_tokens>N tokens left</total_tokens>` counter the
  barrier rules depend on. If it does not, rules 2-3 need a different measure (e.g. a counted tool
  calls budget).
- The `Workflow` tool is allowed through by the user's permission mode at launch time.
- Haiku 4.5 follows the barrier procedure reliably with the inlined prompt. The smoke test runs a
  small target skill end to end before any large one.

Smoke test 2026-10-06: pass, with one finding. Target: 5-step fixture, `--limit 25000`. Counter visible
(numeric `used=` in every progress.log line, no "blocked: counter not visible"). Handoff fired
(segment 1 handed off with all six headings). Every segment ran on `claude-haiku-4-5-20251001`
(journal shows no other model). Segment 2 ran T1-T3 and returned `blocked` at P1; after `DONE-MAIN P1`
and a second launch confirmation, `startSegment: 3` ran T5 only and returned `done`;
handoff-1.md and handoff-2.md were unchanged (md5). Finding: a Haiku segment's baseline is about
28-31k counter tokens before real work (segment 1 hit the 25k limit after reading the task files and
did nothing; segment 3 used 31k for one task), so `--limit` below about 50k wastes segments. The
default 100000 is fine. Also, Haiku wrote one inaccurate gotcha in handoff-2.md (a `wc -l` remark),
so handoff prose needs a skim.

## 12. Non-goals

- Changing how any existing skill works.
- Running steps in parallel (segments are sequential, rule 7).
- Escalating Haiku failures to another subagent model.
- Splitting a skill that targets `haiku-split` itself.
