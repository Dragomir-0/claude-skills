---
name: roadmap-loop
description: >
  Run the roadmap loop on the next Active row of .claude/roadmap.md: link the row's ticket,
  execute-plan, then loop test-feature + kevin + corrections until test-feature says "ship" and
  kevin has no Critical issues, then cleanup-crew, one PR per repo, and stop at green PRs. With
  --merge only: merge on green CI (in the plan's deployment order), pull main, and repeat until the
  roadmap phase has no Active rows. Never merges by default. Never spawns a
  subagent. Triggered by /roadmap-loop.
disable-model-invocation: true
---

# roadmap-loop

Usage: `/roadmap-loop [--merge] [--issues]`. **By default it never merges and never creates a
ticket.** It runs the next `Active` row
through to green pull requests, reports them and stops, leaving the merge to the user. With
`--merge` it also merges each PR once its checks are green and keeps going row after row until the
phase is finished. It orchestrates `execute-plan`, `test-feature`, `kevin` and `cleanup-crew`; each of
those keeps its own rules except where this file says otherwise. It works against GitHub or Azure
DevOps, chosen per repo from its `origin` remote (see Hosts).

**Never spawn a subagent — not via `Agent`, not via `Workflow`, not via any other dispatch
surface.** Every step runs in this session. This is not softened by anything below.

## Standing authorization (recorded 2026-10-13, given by the user)

These replace the per-step hard pauses *for this loop only*, and only inside this scope:

- **Repos:** only the repos this project names: the `**Repos:**` line of the plan being run. Each
  must be a checkout in this workspace and is resolved to its host and repository from its own
  `origin` remote (see Hosts). Nothing is hard-coded. The base branch is each repo's default
  branch, usually `main`; `main` below means that base branch. A plan that names a repo with no
  checkout or no recognised `origin` → stop and ask.
- **Milestone approval:** a milestone is approved automatically when its own verification passes.
  Write `APPROVED | milestone=<N> | by=roadmap-loop` to the ledger (plan-pruning reads the number).
- **Cleanup-crew pauses** (branch, base, commit message) are pre-answered — see step D.
- **Merge, only when `--merge` is passed:** squash-merge a PR to `main` once every check is green,
  in the plan's deployment order (backend before frontend when the plan is silent), then delete the
  branch. Without `--merge` this authorization does not apply and the loop never merges.
- **Round cap:** none. The brakes are the repeat-finding stop (step C) and the 350k-per-milestone
  budget guard.

Nothing here authorizes force-pushing, pushing to `main` directly, merging without `--merge`, merging with a red or
missing check, repos the plan does not name, or weakening a check to get it green.

## Hosts

Detect the host of each repo from `git remote get-url origin`, never from assumption:

- `github.com` → **GitHub**, driven with `gh`.
- `dev.azure.com`, `ssh.dev.azure.com` or `*.visualstudio.com` → **Azure DevOps**, driven with the
  Azure CLI (`az repos`, `az pipelines`, with the `azure-devops` extension). Take the organization,
  project and repository name from the remote URL and pass them explicitly
  (`--organization`, `--project`, `--repository`) rather than relying on configured defaults.
- Anything else → stop and ask. Do not guess a CLI.

A plan can name repos on different hosts; use each repo's own column below.

| Need | GitHub | Azure DevOps |
|---|---|---|
| Signed in | `gh auth status` | `az account show` and `az devops -h` works |
| Default branch | `gh repo view --json defaultBranchRef` | `az repos show --query defaultBranch` |
| PR for the branch (any state) | `gh pr list --head feature/<Name> --state all` | `az repos pr list --source-branch feature/<Name> --status all` |
| Open the PR | `gh pr create --base main --head feature/<Name>` | `az repos pr create --source-branch feature/<Name> --target-branch main --title ... --description ...` (add `--work-items <id>` when a ticket is linked) |
| Watch the checks | `gh pr checks --watch` | `az repos pr policy list --id <n>` plus `az pipelines runs list --branch feature/<Name>`, polled from a background until-loop |
| Read a failure | `gh run view --log-failed` | `az pipelines runs show --id <run>` and the run's logs |
| Merge (only with `--merge`) | `gh pr merge --squash --delete-branch` | `az repos pr update --id <n> --status completed --squash true --delete-source-branch true` |

Azure DevOps has no `--watch`: poll in a background command and wait for its notification, never
with foreground sleeps. If a branch policy blocks completion, that is a stop, not something to
bypass (`--bypass-policy` is never used).

## 0 — Gate

- **Plan mode active → STOP:** "roadmap-loop executes; approve first."
- **Arguments:** `--merge` and `--issues` are the only ones; both are off unless given. Anything
  else → stop and say so.
- **Preflight, every repo the plan names:** on `main`, clean working tree, `git fetch`
  shows `main` level with `origin/main`, and the host CLI is signed in (see Hosts). Anything else → stop and
  say what is wrong; do not switch branches over uncommitted work.
- **Resume detection.** The state lives in three places, so a restart picks up cleanly:
  `.claude/roadmap.md` (row Status), the item's `.claude/plans/<Name>.ledger.md`
  (`CORRECTIONS`, `APPROVED`, `LOOP` lines), and the host (PR lookup per Hosts). A repo
  already on `feature/<Name>`, or an open PR for it, means the item is mid-flight: resume at the
  matching step instead of starting over. A PR for `feature/<Name>` that is already merged (by the
  user, or by an earlier `--merge` run) resumes at step G. Print which step you resumed at.

## 1 — Select the item

Read `.claude/roadmap.md`. The target is the **first `Active` row in file order** — that order is
the user's priority; never re-sort. Skip `Future` and `Done`.

- No `Active` row → report the phase complete (step G) and stop.
- Read only the plan header: `**Repos:**`, `**Roadmap phase:**`, `**Depends on:**`. The *phase* for
  this run is that row's phase. A `Depends on:` that names a row not yet `Done` → stop and ask;
  don't reorder.
- Print the row, the repos, and the projected cost (`execute-plan` §1). Then continue.

## A — Tickets

**By default the loop creates no issue and no work item.** Ticket processes differ per project
(Azure DevOps work-item types, required fields and states vary by process), so an auto-created one
can be wrong or rejected. Instead, find the ticket the work already belongs to: the reference
recorded in the plan header or on the roadmap row, wherever `plan-feature` put it (an Azure DevOps
work-item id or link, or a GitHub issue number). Record `LOOP | ticket=<repo>:<id>` in the ledger,
or `LOOP | ticket=none` when there is none; both are fine and the loop continues either way.

- **`--issues`** (opt-in, GitHub repos only): create one issue per repo with `gh issue create`,
  titled with the row's Title, body giving the phase, plan name and acceptance criteria in plain
  words, and record `LOOP | ticket=<repo>#<n>`. On an Azure DevOps repo `--issues` is ignored with
  one printed line saying so: work items are linked by id, never created.
- How a ticket is linked: a GitHub issue as `Closes #<n>` in the PR body; an Azure DevOps work item
  as `AB#<id>` in the commit message and PR description and via `--work-items <id>` on the PR.

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

- Step 5: refresh `README.md`; append to the gitignored `changes.md` with the ticket reference (none when there is none).
- Steps 6–7: the ticket is the reference from step A (`"tickets": []` when none); compose a conventional commit (`feat:`/`fix:` plus
  the row's title), print the composed command, and run it **without waiting**. Show the staged file
  list in the same message and abort only if it contains something that looks like a secret or build
  output. Push `feature/<Name>`.
- **Defer its steps 8–9** (plan pruning, handoff) until after the merge (step G). Deleting the plan
  now would break a correction round if CI fails.
- Skip its "context is large — `/clear`" stop; this loop is meant to run long.

## E — Pull requests

In the plan's deployment order (backend before frontend when silent), only the repos with
changes. Open each PR with its host's command (see Hosts); the body has the summary, the test-feature verdict and coverage line, the kevin
verdict, rounds taken, remaining Warnings/Minor items, "Known follow-ups", and the ticket link from step A when there is one.

## F — CI and merge

1. Watch the checks of each PR with its host's command (see Hosts; long waits run in the
   background and you wait for the notification, no sleep loops).
2. **Every check green and `--merge` passed →** squash-merge with the host's command (see Hosts)
   and delete the branch, in that same deployment order. Never merge with a failing, pending or missing check.
   **Every check green and no `--merge` →** do not merge. Print each PR's URL and check state, ask the
   user to merge them (or to re-run `/roadmap-loop --merge`), and **stop**: the row stays `Active` and
   step G does not run. A later run finds the PRs merged and resumes at step G.
3. **Red check, or a merge conflict →** treat it as a correction round: read the failure
   (the host's failure-log command, see Hosts), fix the cause (never skip a test, loosen a threshold, delete a
   check or edit the workflow just to pass), commit to the same branch as a new commit, push, and
   re-run **C** before re-checking CI. The repeat-finding stop applies to CI too: the same failing
   check with the same cause twice means stop and ask. Never force-push; resolve a conflict by
   merging `origin/main` into the branch.
4. If an earlier repo merged and a later one then fails, leave the merged one. Fix the failing
   repo; never unwind.

## G — After the merge (only once the PRs are merged)

- Every repo that changed: `git checkout main && git pull`; confirm a clean tree and, for a linked GitHub
  issue, that it is closed (Azure DevOps work items follow the board's own PR-completion rules; do
  not edit them).
- Run `/cleanup-crew` steps 8–9 (prune the finished plan, remove the consumed handoff doc).
- Set the row's Status to `Done` in `.claude/roadmap.md`.
- Print a one-table summary: repo, PR, merge commit, ticket, rounds taken.
- **Next row:** go to step 1. If this phase has no more `Active` rows, **stop** and give the phase
  summary (rows shipped, rounds per row, leftover Warnings and follow-ups). Do not roll into the
  next phase.

## Stop and ask (the loop never guesses past these)

A contradictory plan · budget ceiling reached · repeat finding · a task needing an Opus-tier
session · `Depends on` not satisfied · a dirty or diverged `main` · a host CLI that is not signed in · an unrecognised host · no browser
surface for a frontend item · a conflict that is not mechanical · anything that would touch a repo or
branch outside the scope above.

## Common mistakes

- Running `/execute-plan --roadmap` instead of single-plan mode: it hard-pauses per item and runs
  its own grading, which duplicates this loop.
- Running cleanup-crew's stash/branch steps over an existing `feature/<Name>` branch.
- Pruning the plan before the merge, then needing it for a CI correction round.
- Calling a verdict of "fix first" clean. Only "ship" exits the loop.
- Merging without `--merge`, or out of the plan's deployment order.
- Creating an issue or work item without `--issues`, or running `gh` against an Azure DevOps remote
  (or `az repos` against GitHub). Read the host from `origin` every time.
- Fixing a red check by weakening it.
- Skipping the saved `.round<k>` reports and judging "repeat" from memory.
- Treating an optional correction item as mandatory (runaway) or a mandatory one as optional.
