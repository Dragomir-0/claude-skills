---
name: roadmap-loop
description: >
  Run the roadmap loop on the next Active row of .claude/roadmap.md: open GitHub issues,
  execute-plan, then loop test-feature + kevin + corrections until test-feature says "ship" and
  kevin has no Critical issues, then cleanup-crew, one PR per repo, merge on green CI (in the
  plan's deployment order), pull main, and repeat until the roadmap phase has no Active rows. Never spawns a
  subagent. Triggered by /roadmap-loop.
disable-model-invocation: true
---

# roadmap-loop

Takes no arguments. It runs the next `Active` row and keeps going row after row until the phase
is finished. It orchestrates `execute-plan`, `test-feature`, `kevin` and `cleanup-crew`; each of
those keeps its own rules except where this file says otherwise.

**Never spawn a subagent — not via `Agent`, not via `Workflow`, not via any other dispatch
surface.** Every step runs in this session. This is not softened by anything below.

## Standing authorization (recorded 2026-10-13, given by the user)

These replace the per-step hard pauses *for this loop only*, and only inside this scope:

- **Repos:** only the repos this project names: the `**Repos:**` line of the plan being run. Each
  must be a checkout in this workspace and is resolved to its GitHub `owner/name` from its own
  `origin` remote (`gh repo view --json nameWithOwner,defaultBranchRef`). Nothing is hard-coded.
  The base branch is each repo's default branch, usually `main`; `main` below means that base
  branch. A plan that names a repo with no checkout or no GitHub `origin` → stop and ask.
- **Milestone approval:** a milestone is approved automatically when its own verification passes.
  Write `APPROVED | milestone=<N> | by=roadmap-loop` to the ledger (plan-pruning reads the number).
- **Cleanup-crew pauses** (branch, base, commit message) are pre-answered — see step D.
- **Merge:** squash-merge a PR to `main` once every check is green, in the plan's deployment order
  (backend before frontend when the plan is silent), then delete the branch.
- **Round cap:** none. The brakes are the repeat-finding stop (step C) and the 350k-per-milestone
  budget guard.

Nothing here authorizes force-pushing, pushing to `main` directly, merging with a red or missing
check, repos the plan does not name, or weakening a check to get it green.

## 0 — Gate

- **Plan mode active → STOP:** "roadmap-loop executes; approve first."
- **Preflight, every repo the plan names:** on `main`, clean working tree, `git fetch`
  shows `main` level with `origin/main`, `gh auth status` is signed in. Anything else → stop and
  say what is wrong; do not switch branches over uncommitted work.
- **Resume detection.** The state lives in three places, so a restart picks up cleanly:
  `.claude/roadmap.md` (row Status), the item's `.claude/plans/<Name>.ledger.md`
  (`CORRECTIONS`, `APPROVED`, `LOOP` lines), and GitHub (`gh pr list --head feature/<Name>`). A repo
  already on `feature/<Name>`, or an open PR for it, means the item is mid-flight: resume at the
  matching step instead of starting over. Print which step you resumed at.

## 1 — Select the item

Read `.claude/roadmap.md`. The target is the **first `Active` row in file order** — that order is
the user's priority; never re-sort. Skip `Future` and `Done`.

- No `Active` row → report the phase complete (step G) and stop.
- Read only the plan header: `**Repos:**`, `**Roadmap phase:**`, `**Depends on:**`. The *phase* for
  this run is that row's phase. A `Depends on:` that names a row not yet `Done` → stop and ask;
  don't reorder.
- Print the row, the repos, and the projected cost (`execute-plan` §1). Then continue.

## A — Issues

One issue per repo the plan touches: `gh issue create` in that repo, title is the row's Title,
body gives the phase, plan name and the acceptance criteria in plain words. Record
`LOOP | issue=<repo>#<n>` in the ledger once `execute-plan` has created it (hold the numbers in the
session until then).

## B — Build

Invoke `/execute-plan` on the row's plan in **single-plan mode** (never `--roadmap`; this loop is
its own convergence loop). Two changes to its stops, nothing else:

- **Milestone hard stop → verify and continue.** Run the milestone's own verification (the plan's
  "Testable when" plus the repo's build and test commands). Pass → write the `APPROVED` line and go
  on. Fail → fix it as `execute-plan` §4 would, without asking.
- **§7 hand-off to `finishing-a-development-branch` is skipped.** Steps D–F replace it.

Still binding, so still stops the loop for the user: a self-contradictory plan, a task scored 8–10
while the session is below Opus tier, the 350k budget ceiling, and a missing-input question.

## C — Grade and correct (repeat until clean)

1. `/test-feature --plan <plan> --optimism 3`. Before overwriting, copy the previous report to
   `.claude/reports/<report>.round<k>.md`.
2. `/kevin --plan <plan>`, same copying. If the plan touches **no frontend repo** (backend-only),
   skip kevin, write `LOOP | kevin=n/a (no frontend)` and let test-feature alone decide. If the plan
   does touch a frontend and no browser surface is available, stop and say so.
3. **Clean means both:** test-feature's verdict is exactly **ship**, and kevin reports **no
   Critical issues** (and its verdict is not "broken"). Warnings, Confusing and Minor items that
   remain do not block; they go into the PR body.
4. **Not clean →** merge both Correction Plans into one de-duplicated, repo-tagged list. Include
   every non-optional item. Include an item marked optional only if it is what is keeping the
   verdict from being "ship"; otherwise list it under "Known follow-ups" in the PR. Run the list
   through `execute-plan` §2–§4 as a synthetic milestone, write
   `CORRECTIONS | round=<k> | source=test-feature+kevin | items=<n>`, then go back to 1.
5. **Repeat-finding stop.** If a finding the previous round's corrections targeted is still present
   in the new reports, or a fix brings back a finding from an earlier round, **stop**: report the
   finding, what was tried each round, and ask. Compare against the saved `.round<k>` reports; do
   not trust memory.

## D — Cleanup (per repo with changes)

Run `/cleanup-crew` with these pre-answers. The work is already on `feature/<Name>` (created by
`execute-plan`), so **skip its steps 1–4** (stash, base checkout, branch creation, stash pop): they
would collide with the existing branch. Start at its step 0 drift check, then:

- Step 5: refresh `README.md`; append to the gitignored `changes.md` with the issue number as ticket.
- Steps 6–7: ticket is the repo's issue number; compose a conventional commit (`feat:`/`fix:` plus
  the row's title), print the composed command, and run it **without waiting**. Show the staged file
  list in the same message and abort only if it contains something that looks like a secret or build
  output. Push `feature/<Name>`.
- **Defer its steps 8–9** (plan pruning, handoff) until after the merge (step G). Deleting the plan
  now would break a correction round if CI fails.
- Skip its "context is large — `/clear`" stop; this loop is meant to run long.

## E — Pull requests

In the plan's deployment order (backend before frontend when silent), only the repos with
changes. `gh pr create --base main --head
feature/<Name>`; the body has the summary, the test-feature verdict and coverage line, the kevin
verdict, rounds taken, remaining Warnings/Minor items, "Known follow-ups", and `Closes #<n>`.

## F — CI and merge

1. `gh pr checks --watch` for each PR (long waits: run it in the background and wait for the
   notification; no sleep loops).
2. **Every check green →** `gh pr merge --squash --delete-branch`, in that same deployment order. Never
   merge with a failing, pending or missing check.
3. **Red check, or a merge conflict →** treat it as a correction round: read the failure
   (`gh run view --log-failed`), fix the cause (never skip a test, loosen a threshold, delete a
   check or edit the workflow just to pass), commit to the same branch as a new commit, push, and
   re-run **C** before re-checking CI. The repeat-finding stop applies to CI too: the same failing
   check with the same cause twice means stop and ask. Never force-push; resolve a conflict by
   merging `origin/main` into the branch.
4. If an earlier repo merged and a later one then fails, leave the merged one. Fix the failing
   repo; never unwind.

## G — After the merge

- Every repo that changed: `git checkout main && git pull`; confirm a clean tree and that each issue is closed.
- Run `/cleanup-crew` steps 8–9 (prune the finished plan, remove the consumed handoff doc).
- Set the row's Status to `Done` in `.claude/roadmap.md`.
- Print a one-table summary: repo, PR, merge commit, issue, rounds taken.
- **Next row:** go to step 1. If this phase has no more `Active` rows, **stop** and give the phase
  summary (rows shipped, rounds per row, leftover Warnings and follow-ups). Do not roll into the
  next phase.

## Stop and ask (the loop never guesses past these)

A contradictory plan · budget ceiling reached · repeat finding · a task needing an Opus-tier
session · `Depends on` not satisfied · a dirty or diverged `main` · missing `gh` auth · no browser
surface for a frontend item · a conflict that is not mechanical · anything that would touch a repo or
branch outside the scope above.

## Common mistakes

- Running `/execute-plan --roadmap` instead of single-plan mode: it hard-pauses per item and runs
  its own grading, which duplicates this loop.
- Running cleanup-crew's stash/branch steps over an existing `feature/<Name>` branch.
- Pruning the plan before the merge, then needing it for a CI correction round.
- Calling a verdict of "fix first" clean. Only "ship" exits the loop.
- Merging out of the plan's deployment order.
- Fixing a red check by weakening it.
- Skipping the saved `.round<k>` reports and judging "repeat" from memory.
- Treating an optional correction item as mandatory (runaway) or a mandatory one as optional.
