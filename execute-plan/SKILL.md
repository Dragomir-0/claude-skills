---
name: execute-plan
description: >
  Execute an approved FEATURE_PLAN milestone by milestone: decompose into atomic tasks,
  dispatch capped subagents via the Workflow tool under a hard token ceiling, verify every
  result as controller, re-evaluate regressions, and hard-pause at each milestone for user
  testing. With --roadmap, works through every Active item in .claude/roadmap.md instead,
  looping build / test-feature / kevin / corrections per item until both come back clean.
  Triggered by /execute-plan.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Workflow, Skill, AskUserQuestion, TaskCreate, TaskUpdate
---

# execute-plan

You are the **controller**. Subagents write code; you decide whether it is right. The plan is the
source of truth. Artifact paths and cost discipline come from
`~/.claude/skills/_shared/pipeline-contract.md`. The complexity rubric used in §3 comes from
`~/.claude/skills/_shared/complexity-scoring.md`.

## 0 — Gate

- **`--roadmap` passed?** Skip everything below — go to §11 instead. Roadmap mode processes
  several plans; the rest of this gate through §10 governs a single plan.
- **If plan mode is active, STOP:** "execute-plan implements an approved plan — approve it
  first." This skill executes; it does not write plans.
- **Locate the plan:** an explicit argument, else the newest `.claude/plans/FEATURE_PLAN_*.md`
  (check the container as well as the current repo), else ask. Read it **once** and extract the
  selected tier, its File Impact Manifest, its milestones, the test cases, the contingency
  section, and — if present — its `## Design Direction`. Its absence means the plan was judged
  non-UI at planning time; don't invent one.
- **Determine the repo set** from the plan's `**Repos:**` line and the manifest's Repo column.
  One repo → everything below behaves as it always has. Several → see *Cross-repo execution*.
- **Conflict scan, one shot:** read the plan for contradictory tasks or plan-mandated defects.
  Batch-ask which governs before starting. Clean → proceed silently.

## 1 — Budget guard

**The ceiling is 350k output tokens per milestone.** Set it as `budget.total` in the Workflow
script.

Before dispatching anything, print the milestone's projected cost by summing the plan's per-task
token bands (S ~5–15k, M ~15–40k, L ~40–100k, XL >100k). Show it to the user alongside the
ceiling.

While running, check `budget.remaining()` before each dispatch. When it falls below the next
task's estimate, **hard-stop and ask** whether to continue. Never silently exceed the ceiling.

The figure is revisable — the user can raise it for a given run — but it is never quietly
ignored. This exists because a runaway execution loop can consume a week's allowance in a single
milestone.

## 2 — Model policy

| Role | Model | Does |
|---|---|---|
| **Controller — you** | session model, typically Opus 5 | decompose, **owns every verification** (adjudicates the result even when the mechanical diff-check for a large diff is delegated per §5), regression re-eval, adjudication; primary implementer for any task scored 8-10 |
| **Subagent — mechanical** | `claude-haiku-4-5-20251001` | tasks scored 1-3; optional mechanical helpers alongside a 4-7 task |
| **Subagent — judgment** | `claude-sonnet-5` | primary implementer for tasks scored 4-7; every escalation |

🔒 **Subagents never exceed Sonnet.** Always specify the model explicitly on every dispatch — an
omitted model inherits the controller's Opus and violates the cap. "Mechanical" and "judgment"
above are the score-1-3 and score-4-7 bands from §3's complexity scoring; a task scoring 8-10 has
the controller as primary implementer, still backed by normal Haiku/Sonnet subagent scaling for
whatever separates out — Opus itself is never a subagent's model, only the controller's.

## 3 — Decompose

Break the current milestone into the **smallest possible single-step atomic tasks** — "create
interface X", "implement method Y", "update unit test Z". For each, write a self-contained brief:
goal, files, interfaces produced by earlier tasks, acceptance criteria, the plan's global
constraints, and the model tier. If the plan carries a `## Design Direction` and the task touches
a UI file, include it verbatim in the brief's global constraints — this is what keeps every UI
task visually consistent without each subagent re-deriving style choices on its own.

Score each task against its own brief using the task-level rubric in
`~/.claude/skills/_shared/complexity-scoring.md`, then dispatch accordingly:

| Score | Dispatch |
|---|---|
| 1-3 | `claude-haiku-4-5-20251001`. |
| 4-7 | `claude-sonnet-5` as primary implementer; may optionally peel off strictly mechanical sub-pieces to `claude-haiku-4-5-20251001` subagents run alongside it. |
| 8-10 | Controller (Opus) is the primary implementer — no capped subagent owns a task this hard. Still dispatch the normal Haiku/Sonnet subagent scaling from §1/§4 for any genuinely separable mechanical portions; leading the hard part directly doesn't mean doing all of it solo. |

Record the score on the task's ledger line (`score=<n>`, see §7) so a resumed run can see why a
task landed where it did without re-deriving the call.

## 4 — Escalation ladder

Governs the **primary implementer** for a task. Two subagent attempts, then you take over — except
a task scored 8-10 in §3, where the controller is the primary implementer from the start, not a
fallback reached after failed attempts.

1. **Attempt 1** — the model §3's score assigned: `claude-haiku-4-5-20251001` for a 1-3, or
   `claude-sonnet-5` for a 4-7. (An 8-10 task starts at step 3 — see above.)
2. **Attempt 2** — `claude-sonnet-5`, with your findings from attempt 1. A task that started at
   Haiku escalates a tier; a task that started at Sonnet gets one retry with findings — there's no
   capped tier above it to escalate to, and a third identical-tier attempt would buy no new
   capability over the second, only more tokens spent hoping for a different outcome.
3. **Controller** — you implement the task yourself. Progress is never blocked by a capped model.

This ladder runs alongside, not instead of, the supporting subagent scaling in §3 — a 4-7 task's
optional Haiku helpers, or an 8-10 task's normal fan-out for its separable mechanical portions, are
dispatched and verified independently of where the primary implementer sits on this ladder.

The original brief called for escalating to Opus after a third failed attempt. That is
deliberately replaced by "the controller does it," reached one round sooner — the same capability,
without handing an unsupervised subagent the expensive model or paying for a third attempt at a
tier that already failed twice.

## 5 — Verification

**A capped subagent never grades its own work** — a verifier is always a different subagent than
the one that implemented the task, never the same instance. After every task, verify the diff
against:

1. the atomic task brief, and
2. the plan's global constraints and test cases.

Check adherence to the architecture map, syntax correctness, logical errors, and alignment with
the atomic task goal — and, for a UI diff, adherence to the plan's Design Direction (style,
palette, typography, component patterns). Large diff → dispatch a dedicated `claude-sonnet-5`
verifier subagent to keep your context clean. Small diff → verify inline.

**Delegating the mechanical diff-check doesn't delegate the decision.** Read the verifier's report
and adjudicate pass/fail yourself before moving on — that adjudication is what §2 means by the
controller "owning" verification. A verifier subagent may do the reading; only you decide what it
means.

If errors are found, return a **strict list of corrections** to feed into the next attempt.

## 6 — Regression re-evaluation

After each task, validate the **integration so far**, not just the new task. If a later task
broke an earlier one: re-run the affected earlier tests, locate the regression, dispatch a fix.

**The plan governs.** If the plan is genuinely self-contradictory — a later step cannot coexist
with an earlier one — STOP and escalate it to the user as a plan defect. Do not improvise around
it.

## 7 — Ledger

`.claude/plans/<Name>.ledger.md` is the compaction-proof recovery map. First line names the plan
file. Append one line per dispatch **and** per verification:

```
STAT | task=<N> | score=<1-10> | repo=<name> | role=subagent|verifier|verify-inline | model=<haiku-4-5|sonnet-5|controller> | round=<k> | status=<DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT|PASS|FAIL> | tokens=<n>
```

`score=` is the task's complexity-scoring result from §3 — it's what determined `model=` for that
task's first dispatch, so keep both even when a later round escalates past it.

`repo=` is always present — single-repo runs repeat one value. Without it a resumed run cannot
tell which repository a task belonged to, and a cross-repo ledger becomes unreadable after
compaction.

For a cross-repo plan the ledger lives at `<container>/.claude/plans/<Name>.ledger.md` and
records the branch name for each repo.

Keep a rollup at the top of the section: dispatches by tier, verifier count, total fix rounds,
cumulative tokens against the 350k ceiling, and a per-repo task count. A `model=` value above
`sonnet-5` on a subagent or verifier line is a cap violation and a red flag.

**Model.** Appending these lines is pure bookkeeping — no judgment beyond copying values you
already hold. Don't write the ledger yourself line-by-line; have whichever subagent just ran (task
dispatch or verifier) append its own `STAT` line as its last action before reporting back, so no
extra round trip is spent on it. For a line the controller itself is responsible for (a task it
implemented directly at score 8-10, or the rollup edit), batch pending lines and dispatch a single
`claude-haiku-4-5-20251001` subagent via `Workflow` to append them once per task or per milestone
rather than editing the ledger file yourself.

## 7b — Cross-repo execution

When the plan names more than one repo:

- **One branch per affected repo.** Each repo is independently versioned, so each needs its own
  branch off its own `main-windows`/`main`, created in place in that repo's own directory. Create
  them all before the milestone starts and record the mapping in the ledger — a task dispatched
  against the wrong repo directory edits the wrong repository.
- **Every atomic task names its repo.** The task brief states the repo and its directory; paths
  inside the brief stay repo-relative. Never hand a subagent a path it must resolve against an
  unstated root.
- **Verification is per repo, integration is across them.** Verify each task in its own repo, then
  ask the separate question of whether the repos still agree — a backend route rename verifies
  perfectly while breaking the client that calls it.
- **Respect the plan's deployment ordering.** Where a milestone states one, the task order must
  follow it. If the plan is silent and the change crosses a contract, stop and ask rather than
  guessing an order.
- **Contract regeneration is a task, not a cleanup step.** If the plan names a regeneration command
  (a generated client, a schema, stubs), dispatch it as its own atomic task and verify its output
  like any other diff.
- **The 350k ceiling is per milestone, not per repo.** A milestone spanning four repos gets the
  same budget as one spanning a single repo. Say so when projecting cost.

## 8 — Isolation and milestone pause

Isolate the workspace with a **branch, in place** — never a worktree. For a cross-repo plan this
means one branch per affected repo, each checked out in that repo's own directory, per §7b.

**Step 0 — detect existing isolation.** If the current branch is not the repo's base branch
(neither `main-windows` nor `main`), the workspace is already isolated — skip branch creation and
build on the branch you're on.

**Step 1 — resolve the base branch.** `main-windows` if it exists, else `main`:

```bash
if git show-ref --verify --quiet refs/heads/main-windows || \
   git show-ref --verify --quiet refs/remotes/origin/main-windows; then
  BASE_BRANCH=main-windows
else
  BASE_BRANCH=main
fi
```

**Step 2 — branch off it.**

```bash
git checkout "$BASE_BRANCH"
git pull
git checkout -b "feature/<Name>"
```

`<Name>` is the plan's own name derivation (`~/.claude/skills/_shared/pipeline-contract.md`). If
`git checkout "$BASE_BRANCH"` would discard uncommitted work, stop and ask rather than switching
over it.

If the target is not a git repo at all, say so and build in place — there is nothing to branch.

Execute tasks sequentially until the milestone is complete, then **hard stop** and print exactly:

> Milestone [X] complete. Please run your tests and verify the functionality. Type 'Approve' to
> begin the next milestone, or provide feedback for corrections.

Wait for explicit input. Do not decompose the next milestone until approved.

## 9 — If the Workflow opt-in is declined

The Workflow tool needs the user's multi-agent opt-in. If declined, **degrade to a
single-context executor**: do each task yourself with the same verify / fix / regression loop,
and say so plainly. Do not silently fall back to a weaker process.

## 10 — Finish

Run the plan's end-to-end verification section plus a final whole-branch review. Declare done
only when **all** acceptance criteria and test cases pass — evidence before assertions. Then hand
off to `superpowers:finishing-a-development-branch`, or report status plainly if the target is
not git.

## 11 — Roadmap execution

`/execute-plan --roadmap [--optimism <1-5>]`. A roadmap is just a list of feature plans — the
register at `.claude/roadmap.md` (container-level too, in a workspace) that `plan-feature` writes.
This mode works through it instead of a single plan, converging each item before moving to the
next.

**Locate the register.** If `.claude/roadmap.md` doesn't exist, say so and stop — there is
nothing to execute. Read every row.

**Select rows.** Only rows with Status `Active` are in scope, in the order they appear in the
file — that order is the user's own priority, not something to re-sort. Skip `Future` rows: print
which were skipped and that `plan-feature`'s Design checkpoint means they aren't meant to be built
yet. Skip rows already `Done`. If nothing is `Active`, say so and stop.

**Before starting, name the cost.** Print how many `Active` rows were found. Each one runs its own
full build plus a test-feature/kevin convergence loop that can itself repeat several rounds — this
is a multi-x spend over a single-plan run, the contract's escalation checkpoint. State that plainly
before the first item starts.

### Per-item convergence loop

For each selected row, in order:

1. **Build.** Run §0 through §10 exactly as normal against that row's Plan path. Nothing about
   milestone execution changes in roadmap mode — the same per-milestone hard stop in §8 still
   applies; roadmap mode does not run milestones unattended.
2. **Grade the diff.** Invoke the `test-feature` skill (`Skill` tool) with
   `--plan <path> --optimism <n>` (`<n>` is the roadmap invocation's `--optimism`, default 3).
   `test-feature` never spawns subagents by its own rule — nothing extra to enforce here.
3. **Grade the live app.** Invoke the `kevin` skill (`Skill` tool) with `--plan <path>`.
4. **Check convergence** against both reports:
   - **test-feature clean** — Verdict is not "do not ship", and Critical Failures is empty.
     (Warnings may remain; those aren't the "major errors" this loop gates on.)
   - **kevin clean** — Verdict is not "broken", every acceptance criterion/milestone in Coverage
     is marked exercised (none partial or unreachable — a gap there means Kevin never actually
     reached part of the feature, the opposite of understanding it completely), and Issues
     contains no **Critical** entries. (Confusing/Minor may remain.)
   - Both conditions must hold together.
5. **Converged** → set the row's Status to `Done` in `.claude/roadmap.md`, print a short summary
   (what shipped, any remaining Warnings/Confusing/Minor items left for a human to judge), then
   **hard pause**: ask the user before starting the next `Active` row. Do not auto-advance.
6. **Not converged** → merge the two reports' Correction Plans into one de-duplicated, repo-tagged
   task list, and run it through this skill's own §3–§6 decompose/dispatch/verify loop as a
   synthetic milestone. Log it on the item's ledger as its own round:
   ```
   CORRECTIONS | round=<k> | source=test-feature+kevin | items=<n>
   ```
   Then repeat from step 2 — re-grade with fresh test-feature and kevin runs; a correction can
   introduce a new problem as easily as it fixes the reported one.
7. **Round ceiling.** 5 correction rounds per item. Reaching it without converging is a hard stop,
   not a silent continuation: report what's still failing after 5 rounds and ask the user how to
   proceed — raise the ceiling, accept the item as-is, or drop it from this run. Never loop past it
   unasked.

**Resuming a roadmap run.** `.claude/roadmap.md`'s Status column is the resume state — rows already
`Done` are skipped, `Active` rows pick back up at step 1. Check the item's own
`.claude/plans/<Name>.ledger.md` for the highest `CORRECTIONS round=` line to know which round to
resume from rather than restarting the loop at round 1.

## Red flags — STOP

| About to… | Reality |
|---|---|
| Dispatch a subagent without an explicit model | It inherits Opus. Set the model, every time. |
| Let a subagent own the primary implementation of a task scored 8-10 | No capped tier can own it — the controller leads it directly, subagents only help with separable pieces. |
| Let a subagent verify its own work, or skip reading a verifier's report before deciding | The controller adjudicates every verification. A large diff may go to a dedicated Sonnet verifier (§5), but never the same subagent that implemented it, and never without you reading its report and deciding pass/fail yourself. |
| Exceed Sonnet to break a stuck loop | Forbidden. At the cap you take over yourself. |
| Silently pass the 350k ceiling | Hard-stop and ask. The ceiling is the point. |
| Declare "done" without running the plan's verification | Run it. Evidence first. |
| Treat a subagent's edit as truth over the plan | The plan governs. Re-verify. |
| Skip verification because "this task is trivial" | Trivial tasks break integration. Verify every one. |
| Dispatch a task without naming its repo and branch | It will edit the wrong repository. Always state both. |
| Call a cross-repo milestone done after verifying each repo alone | Each repo passing is not the repos agreeing. Check the contract. |
| Treat contract regeneration as tidy-up after the "real" work | It is the change. Dispatch and verify it as a task. |
| Verify a UI diff without checking it against the plan's Design Direction | Style drift compounds silently across milestones — check it every time the plan carries one, not just once. |
| Mark a roadmap item Done because the build finished | Done means test-feature *and* kevin both came back clean. Check both. |
| Run milestones unattended because "it's roadmap mode" | The per-milestone hard stop in §8 is unchanged in roadmap mode. |
| Auto-advance to the next roadmap item without asking | §11 step 5 is a hard pause. Ask before starting the next item. |
| Keep looping corrections past the round ceiling | 5 rounds, then stop and ask. Never loop past it unasked. |
| Execute a `Future` roadmap row | Skip it — plan-feature's Design checkpoint means it isn't meant to be built yet. |

## Next step

Single-plan mode: `/test-feature --plan <path> --optimism <1-5>` grades the result. Name it; do
not invoke it. Roadmap mode (§11) already invokes `test-feature` and `kevin` itself as part of the
convergence loop — nothing further to name once a run finishes.
