# pigeon — design

Date: 2026-11-08 · Status: draft for review

## 1. Purpose

`/pigeon "<task description>"` runs a single feature end-to-end through nine fixed personas —
task researcher, business aligner, UI designer, software developer, test engineer, cybersecurity
expert, refactor developer, infrastructure specialist, release-notes writer — plus a final ship
stage, in one continuous session. Each persona does one job, writes a **handoff document**, and
names the next persona to pick it up. A lightweight routing step (the "pigeon") reads that
handoff, adopts the named persona, and continues. Several personas invoke an existing pipeline
skill (`plan-feature`, `execute-plan`, `test-feature`, `kevin`, `security-review`, `simplify`,
`cleanup-crew`) as their substantive step rather than reinventing it.

This is **not** a subagent system. Every persona switch is the calling session changing its own
operating instructions and writing/reading a file — never a dispatch. That matches this
project's existing "no subagents, anywhere" policy (`_shared/pipeline-contract.md`) and the
user's global instruction forbidding subagent use entirely.

## 2. Decisions (agreed 2026-11-08)

| # | Decision |
|---|---|
| D1 | Nine personas plus a final ship stage, fixed identities, in the order listed in §4. No persona is optional except the UI designer, which is skipped when the task has no frontend surface. |
| D2 | Routing: the **current persona** explicitly names the next persona in its own handoff doc (not inferred by a separate classifier). Backward routing is allowed — any persona may name an earlier persona as "next" when it decides the task itself needs re-scoping. |
| D3 | Pacing is hybrid. Forward hops between personas proceed automatically with a one-line telegraph (`pipeline-contract.md`'s telegraph convention). The run hard-pauses for the user at: the business aligner's cost/timeline checkpoint (§4.2, explicitly requested), any **backward** hop (rework always gets a human look before it restarts), and the cybersecurity expert's findings (§4.6) regardless of direction. Pauses already built into `execute-plan` (per milestone) and `plan-feature` (model-tier gate) fire on their own and are not duplicated here. |
| D4 | Handoff documents live one-per-hop in a dedicated run folder (§6), never overwritten, so the full history of one run is inspectable. |
| D5 | Several personas are thin wrappers around an existing skill rather than new logic: business aligner → `plan-feature`; software developer → `execute-plan`; test engineer → `test-feature --optimism 4` + `kevin` (where a frontend exists) + its own load tests; cybersecurity expert → `security-review`; refactor developer → `simplify`; ship stage → `cleanup-crew`. `pigeon` does not reimplement any of these. |
| D6 | Cleanup: once the ship stage finishes a run, `pigeon` deletes the run's per-hop handoff bodies and keeps a single compact run log (§7) as the only durable trace, since every persona's substantive output already lives in its own proper artifact path per `pipeline-contract.md` (the plan, the ledger, the test/kevin reports) — the handoff docs are pure routing scratch, not a second copy of record. |
| D7 | `pigeon` is a 7th, standalone skill. It does not change any of the six existing pipeline skills' own behavior; it only calls them. `pipeline-contract.md` gets one note (§10) that `pigeon` also reads it, without being added to "the six." |
| D8 | Name/location: `pigeon`, in `~/.claude/skills/pigeon/` (and this repo). Invocation: `/pigeon "<description>"` to start, `/pigeon --resume <Name>` to continue a paused or interrupted run. |

## 3. Invocation

```
/pigeon "<task description>" [--name <Name>]
/pigeon --resume <Name>
```

`<Name>` is derived exactly as `pipeline-contract.md` §"Name derivation" already specifies — an
Azure DevOps work item ID when one is supplied, otherwise a kebab-case slug of the task
description — so a feature's pigeon run folder, plan, ledger, and reports all share one `<Name>`
and are trivially associated. `--name` overrides the derived slug when it would collide or read
poorly.

`--resume` reads the run folder's run log (§7), finds the last hop's `Next:` persona, and
continues from there. A resumed hop is confirmed the same way a fresh backward hop would be if
the resume target is earlier in the sequence than where the run paused (D3).

Every persona that invokes an existing skill (D5) inherits that skill's own model-tier gate
unchanged — `plan-feature`'s and `test-feature`/`kevin`'s gates already check the session's
actual model and pause to ask for a switch when it falls short (`_shared/complexity-scoring.md`).
`pigeon` adds no second gate of its own on top of these.

A `pigeon` run requires a resolved git repo exactly as every other pipeline skill does
(`pipeline-contract.md`'s "Repo resolution"); it stops rather than guessing if there is none.

## 4. Personas & flow

Each persona receives: the previous handoff doc (or the original task description, for the task
researcher's first hop) and the paths to whatever durable artifacts already exist for `<Name>`
(plan, ledger, reports). Each persona ends by writing its own handoff doc (§5) naming the next
persona.

### 4.1 Task researcher (entry point)

Takes the raw task description. Researches how comparable problems have been solved before
(prior art). Asks the user clarifying questions until the goal, its context, and its parameters
are concretely defined — never assumed. Proactively asks for any supporting documents or images
that don't yet exist but would sharpen the definition. Output: a refined problem statement with
context and constraints. On first run for a repo, ensures `.claude/pigeon/` is listed in the
repo's `.gitignore` (mirrors `map-codebase`'s existing self-enforcement of its own paths).

Receives backward hops from: business aligner (can't locate the problem in code), test engineer
(load-test failure — the task didn't account for a resource constraint), cybersecurity expert
(a vulnerability needs folding into the task definition itself).

### 4.2 Business aligner

Takes the refined problem statement and searches the current repo for where it should be solved.
Proposes a location and confirms it with the user; on rejection, keeps searching rather than
giving up after one guess. If it genuinely cannot converge on a plausible location, hands back to
4.1 with "task not defined precisely enough to locate."

Once confident, runs `plan-feature` to produce the implementation plan, and separately produces a
cost/effort estimate **with and without** Claude's involvement (time and rough cost, both ways).
**Hard pause here (D3):** the run stops and shows the user the plan summary and the cost
comparison so they can review a timeline and design with the client before any code is written.

### 4.3 UI designer (conditional — skip when there is no frontend surface)

Looks at the current frontend where the plan touches one, and designs what the new UI should
look like — intuitive, natural, simplified — as something the software developer can build
against. Hands the design (and the plan) forward. Skipped entirely, with a one-line note in the
handoff, for backend-only or non-UI work. "Has a frontend surface" is read off the plan's own
File Impact Manifest (already produced by `plan-feature` in 4.2) — any touched file under a
recognizable UI path/extension counts; pigeon adds no separate detection logic of its own.

### 4.4 Software developer

Runs `execute-plan` against the plan (and the UI design, if 4.3 ran), implementing and verifying
every task itself, writing tests, confirming the code compiles. Keeps the diff as small as the
task allows while still being clearly readable — proper naming, no unrelated refactoring. (This
echoes the project's existing "no premature abstraction" default; the persona just restates it as
its own constraint.) `execute-plan`'s own per-milestone pauses apply unchanged.

### 4.5 Test engineer

Runs `test-feature --optimism 4` against the implementation.
- **Blocking issues found:** hands back to 4.4 with explicit, specific instructions on what's
  wrong and why it must be fixed before shipping.
- **Passes:** also runs `kevin` wherever the change has a frontend to click through, as a
  careless first-time user. Then produces a resource-budget estimate (expected CPU/memory
  footprint under load) and verifies it for real: runs the load tests inside Docker with
  resource limits set to that budget, on a small-Linux base image.
  - **Load tests fail / can't hold the target resource profile:** hands all the way back to 4.1 —
    the task definition didn't account for that constraint, so it needs re-scoping at the root,
    not a patch at the implementation.
  - **Load tests pass:** hands forward to 4.6.

### 4.6 Cybersecurity expert

Runs `security-review` against the implementation.
- **Findings:** hands back to 4.1 — the vulnerability becomes a requirement folded into the
  task's redefinition, not a standalone patch. **Hard pause here regardless of outcome (D3):**
  security findings are shown to the user before the run proceeds, even though the hop itself is
  backward and would already pause under D3's backward-hop rule.
- **Clean:** hands forward to 4.7.

### 4.7 Refactor developer

Pure cleanup pass, no logic changes. Uses the `simplify` skill to review the changed code for
readability/formatting/structure, and to assess whether the test suite accumulated so far can be
consolidated — fewest tests that still cover the most ground, trimming redundant ones.

### 4.8 Infrastructure specialist

Reviews what the finished, cleaned-up change needs to run cleanly through CI/CD (env vars,
secrets, build/deploy steps, new dependencies, pipeline config) and produces a list of what must
be defined or set up before that run is attempted. Does **not** execute any pipeline or
infrastructure change itself — that stays a human action, consistent with treating shared
CI/CD config as hard-to-reverse.

### 4.9 Release notes writer

Only reached once 4.8 completes. Produces a short, client-facing summary of the change in
release-notes form — no internal implementation detail, no persona/pipeline mechanics, something
presentable to the client as-is. Hands forward to 4.10.

### 4.10 Ship (terminal)

Runs the existing `cleanup-crew` skill: stashes, branches off an up-to-date base, restores the
work, refreshes docs, and drives a reviewed conventional commit and push ready for a PR.
`cleanup-crew` already hard-pauses on its own for the base branch, the new branch name, any stash
conflict, and the composed commit — those pauses apply unchanged; `pigeon` adds no extra gate
around them. Ends the run. Triggers cleanup (§7).

## 5. Handoff document format

One file per hop, in the run folder (§6), never overwritten. Fixed header, freeform body:

```
# Pigeon handoff — <Name> — hop <n>

From: <persona>
To: <persona>              # the single most important line — drives routing
Direction: forward | backward
Timestamp: <ISO date/time>

## Context carried forward
<pointers to durable artifacts this hop needs the next persona to know about —
 plan path, ledger path, report paths — not restated content>

## <persona-specific body>
<the actual output: problem statement, location + plan ref + cost estimate,
 UI design, implementation summary, test/load results, security findings,
 refactor notes, infra requirements, or release notes>

## Next
Persona: <next persona, or "none — run complete">
Reason: <one line>
```

A persona reads only the latest handoff plus whatever durable artifact paths it points to — never
the full hop history — to keep each step's context small. The run log (§7) is where the full
history survives after cleanup.

## 6. Run folder

```
.claude/pigeon/<Name>/
├── 01-task-researcher.md
├── 02-business-aligner.md
├── 03-ui-designer.md            # only if 4.3 ran
├── 04-software-developer.md
├── ...                          # one file per hop, numbered in call order, including re-visits
└── RUN_LOG.md
```

Added to the repo's `.gitignore` by the task researcher on first use, the same way
`map-codebase` ensures its own three entries exist (`pipeline-contract.md` §"Artifact
locations"). Numbering is call order, not persona order — a backward hop and its eventual
forward re-hop both get new, higher numbers, so nothing is ever overwritten and the sequence
is replayable.

## 7. Run log and cleanup

`RUN_LOG.md` is a plain append-only table, one row per hop, written alongside the numbered
handoff files as the run proceeds:

```
| Hop | Persona | Direction | Next | Reason |
|---|---|---|---|---|
| 1 | task-researcher | — | business-aligner | problem defined |
| 2 | business-aligner | forward | software-developer | plan P-<Name> approved at checkpoint |
| 3 | software-developer | forward | test-engineer | implementation + tests complete |
| 4 | test-engineer | backward | software-developer | 2 blocking issues found |
| 5 | software-developer | forward | test-engineer | issues fixed |
```

Once the ship stage (4.10) completes, `pigeon` tells the user it is cleaning up, then
deletes every numbered handoff file in the run folder and keeps only `RUN_LOG.md` — the
compact audit trail. The release notes themselves are also copied to
`RELEASE_NOTES_<Name>.md` at the repo root, **not** gitignored — the same carve-out
`pipeline-contract.md` already makes for `ONBOARDING.md`: a people-facing deliverable meant to be
checked in and shared, not a pipeline working file. This is a one-line telegraph, not a hard
pause (D3 reserves pauses for forward-progress decisions, and these are the run's own scratch
files being tidied after the run is already done).

**Loop safety.** If a run bounces back to the same persona more than 3 times without reaching
the next stage forward, `pigeon` pauses and asks the user how to proceed rather than cycling
indefinitely — the same "stop and ask" posture `pipeline-contract.md`'s cost-discipline section
already takes for unbounded spend.

## 8. Files to create

```
~/.claude/skills/pigeon/SKILL.md
~/.claude/skills/pigeon/personas/            # one reference file per persona (9 files, §4)
~/.claude/skills/pigeon/templates/           # handoff.md template, RUN_LOG.md template
```

Mirrored into this repo the same way every other skill here is (it already *is* the skills
directory for this user).

## 9. Documentation changes

1. `_shared/pipeline-contract.md`: add one line to the opening paragraph — `pigeon` also reads
   this file for artifact paths when a persona invokes `plan-feature`/`execute-plan`/
   `test-feature`/`kevin`/`security-review`, but is not one of "the six" and produces none of the
   artifacts in the table itself.
2. `README.md`: add a `pigeon` entry — likely its own short section (parallel to the
   `ui-ux-pro-max` section) rather than a row in the six-skill table, since it sits *above* the
   pipeline rather than inside it, calling multiple existing skills as steps. Also add a
   "Required — Docker" dependency note (parallel to the existing Node/browser notes) for the
   test engineer's load-test verification (§4.5), and stop with a plain message if Docker isn't
   on PATH rather than silently skipping the real-infra check.

Each edit needs the user's explicit approval at the time it's made, per this repo's existing
pattern.

## 10. Non-goals

- Does not change how any of the six existing pipeline skills (or `cleanup-crew`) work
  internally.
- Does not run personas in parallel, or via any subagent/dispatch surface.
- Does not execute any CI/CD or infrastructure change — 4.8 only produces a requirements list;
  4.10 ships the code itself but never touches pipeline/infra config.

## 11. Open questions for the builder-check round

I read this document back adversarially myself (my global config forbids dispatching a subagent
for the usual builder-check, so this round ran inline instead of as a fresh-eyes review). Most
gaps found were settleable without changing what gets built and are already folded into the
sections above — listed here for you to spot-check:

- Release notes get a durable, non-gitignored path (`RELEASE_NOTES_<Name>.md` at repo root),
  mirroring the existing `ONBOARDING.md` carve-out (§7).
- A 3-bounce cap on repeated backward hops to the same persona, past which the run pauses and
  asks rather than cycling (§7).
- "Has a frontend surface," for skipping the UI designer, is read off the plan's File Impact
  Manifest rather than invented separately (§4.3).
- No separate `pigeon`-level model gate — it inherits whichever gate the invoked skill
  (`plan-feature`, `test-feature`, `kevin`) already applies (§4).

Both gaps are now resolved:

- The chain does ship the code — a 4.10 ship stage running `cleanup-crew` now follows the
  release-notes persona.
- The test engineer's load tests (§4.5) produce a resource-budget estimate first, then verify it
  for real by running the load tests in Docker with resource limits set to that budget, on a
  small-Linux base image. Docker becomes a required dependency (§9), and 4.5 stops with a plain
  message rather than skipping the check if Docker isn't available.

No open questions remain. This document is ready to hand to `superpowers:writing-plans`.
