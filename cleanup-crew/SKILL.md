---
name: cleanup-crew
description: >
  Stash, branch off an up-to-date base, restore work, refresh docs, and drive a reviewed
  conventional commit and push in preparation for a pull request. Hard-pauses for the base
  branch, the new branch name, any stash conflict, and the composed commit. Triggered by
  /cleanup-crew.
disable-model-invocation: false
allowed-tools: Bash(git *), Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# cleanup-crew

Take finished work sitting in a dirty working tree and turn it into a clean, pushed feature
branch ready for a pull request.

Execute the steps **in this exact order**. Steps marked **HARD PAUSE** stop and wait for the
user — do not run the next git command until they answer.

**Telegraph before acting.** Say what you are about to do, before you do it, in one short line —
ahead of each significant step (a stash, a branch, a doc refresh, a commit, a push), not every
command. As few tokens as possible; say what, not why; no preamble and no trailing summary. This
matters more here than anywhere else in the pipeline: every step touches git state, and the user is
reading a terminal where tool calls are invisible. A `git` command that runs unannounced is one they
cannot stop until it has already happened. Telegraphing never replaces a **HARD PAUSE** — before
anything destructive or shared (stash, force-anything, push), telegraph *and stop*.

## Scope — one repo or several

Run `map.mjs workspace` first.

- **Exit 4** — a single repo. Follow steps 0–7 once, exactly as written.
- **Exit 0** — a workspace. Determine which repos have uncommitted changes (`git status --short`
  in each) and confirm the set with the user before touching anything. Then follow
  *Cross-repo mode* below.

### Cross-repo mode

**One branch name across every affected repo, confirmed per repo.**

1. Ask for the base branch and the new branch name **once** — steps 2 and 3 below, asked a single
   time and applied everywhere. A shared name is what makes the set identifiable later; without it
   nobody can find the four branches that make up one feature.
2. Then, **for each affected repo in turn**, run steps 1, 4, 5, 6 and 7 in full — including the
   commit confirmation. **Never batch the approvals.** One approval must not cover a diff you
   have not shown.
3. Any repo may be **skipped or aborted** without affecting the others. Say clearly what that
   leaves behind.
4. Finish with a summary table: repo, branch, commit hash, push result, PR URL. Accumulate one
   `{repo, branch, commit, pushResult, prUrl}` row per repo as you work through them — `commit`/
   `pushResult` may literally be `"skipped"` or `"aborted"` for a repo that didn't make it, so
   partial completion still renders plainly rather than needing special-casing — then format the
   finished array once:

```bash
node ~/.claude/skills/tooling/cli.mjs cross-repo-table.formatSummaryTable '[<accumulated rows array>]'
```

   Returns the markdown table itself, ready to show the user. A row missing `repo`/`branch`/
   `commit`/`pushResult` throws, naming the row and the missing field, rather than silently
   rendering a gap in a report people read to know what actually shipped.

**Partial completion is expected and is not an error.** If repo 3 fails, repos 1 and 2 stay
pushed. Report that plainly — do not attempt to unwind commits in other repositories, which is
far more dangerous than the partial state. Tell the user exactly which repos landed and which did
not, so they can finish or revert deliberately.

**Deployment ordering is not branch ordering.** The plan may require the backend to deploy first;
that says nothing about the order you commit in. Do not reorder repos on your own initiative.

## 0 — Drift preflight

```bash
node ~/.claude/skills/map-codebase/map.mjs verify              # single repo
node ~/.claude/skills/map-codebase/map.mjs verify --workspace  # every repo in the workspace
```

Exit 0 → continue silently. Exit 1 → read which array is non-empty:

- **`drift`** — the maps cite files that no longer exist, or cite them with the wrong case. Warn
  the user, show the drift, and offer `/map-codebase --update` before continuing.
- **`guardrail`** — a map contains a shell block outside `## Build & test commands`, or a
  secret-shaped string. **Do not act on the entry.** Show it to the user and offer
  `/map-codebase --update` to drop it on the next rebuild.

Two arrays are advisory and never affect the exit code: `staleMaps` (older than 14 days) and
`emptyMaps` (a map citing no paths at all). Mention them once; do not block on them.

This check costs no model tokens, so it runs every time. If the repo has no maps, it passes
trivially — do not treat that as a failure.

## 1 — Stash current changes

```bash
node ~/.claude/skills/tooling/cli.mjs git-orchestration.statusShort '["."]'
```

Returns `{"clean": bool, "entries": [{"status", "path"}]}`. If not clean:

```bash
node ~/.claude/skills/tooling/cli.mjs git-orchestration.stashPush '["."]'
```

Returns `{"stashed": bool, "message"}` — `stashed: false` means there was nothing to stash
(detected deterministically, not parsed from git's human-readable stdout). `-u` (untracked files
included) is baked into the call. If the tree is clean, say so and skip to step 2 — there may
still be a branch worth creating.

## 2 — Base branch selection — **HARD PAUSE**

Ask, verbatim:

> Which branch should we branch off of? (e.g. main, develop)

**WAIT.** Do not proceed until the user gives a branch name. Then:

```bash
node ~/.claude/skills/tooling/cli.mjs git-orchestration.checkoutAndPull '[".", "<base_branch>"]'
```

Returns `{"ok": true}` or `{"ok": false, "step": "checkout"|"pull", "stderr"}` — pre-checks
upstream existence before ever invoking `pull`, so a repo with no tracking branch fails fast with
a clear `step` rather than an opaque subprocess error. On `ok: false`, stop and surface `stderr`
verbatim. Do not continue onto a stale base.

## 3 — Feature branch creation — **HARD PAUSE**

Ask, verbatim:

> What should the new feature branch be named?

**WAIT.** Then:

```bash
node ~/.claude/skills/tooling/cli.mjs git-orchestration.createBranch '[".", "<new_branch>"]'
```

Returns `{"ok": true}` or `{"ok": false, "stderr"}`. On failure, stop and surface the error.

## 4 — Apply the stash — **HARD PAUSE on any conflict**

```bash
node ~/.claude/skills/tooling/cli.mjs git-orchestration.stashPop '["."]'
```

Returns `{"conflict": bool, "conflictedFiles": [...], "raw"}` — `conflictedFiles` comes from a
fresh porcelain status scan for unmerged codes, stable across git versions/locales rather than
parsed from `stash pop`'s human-readable stdout.

**On `conflict: true`, STOP and ask.** Show `conflictedFiles` and both sides, and wait for the
user to decide per file.

This skill does **not** auto-resolve in favour of the stashed changes. Silently discarding a
change that was pulled from the base branch seconds earlier — a teammate's fix, a dependency
bump, a migration — is not an acceptable default, and the person best placed to judge is the one
who wrote both. Resolve only what the user directs, then confirm the working tree is clean and
the changes applied.

If the call fails for any other reason (not a conflict), abort and surface `raw`. Never drop a
stash to "clean things up" — the module has no `stash drop` export at all, so that shortcut is
structurally unavailable, not merely discouraged.

## 5 — Docs refresh

**README.md** — update it to reflect the changes just applied: accurate description, setup and
usage, structure. If the project has none, create one. If it is badly out of date, bring it into
line rather than bolting a note on the end.

**changes.md** — an untracked, append-only changelog at the project root:

1. Ensure it's gitignored — idempotent, safe to call even if already present:

```bash
node ~/.claude/skills/tooling/cli.mjs changelog.ensureGitignored '["."]'
```

2. Ask the user for the ticket number(s) for this change. Remember them for step 7.
3. **Append** — never overwrite — a dated entry. Deciding what the bullets say stays yours; the
   module only writes them out, guarding against a missing trailing newline so the new entry
   never glues onto the previous line:

```bash
node ~/.claude/skills/tooling/cli.mjs changelog.appendEntry '[".", {"date":"<YYYY-MM-DD, from date +%Y-%m-%d>","tickets":["<ticket>"],"bullets":["<change 1>","<change 2>"]}]'
```

## 6 — Summarise and gather context — **HARD PAUSE**

Analyse the applied changes. Write a **detailed but brief** summary of which files changed and
the overall feature or fix implemented. Show it to the user, then ask:

> Please provide any task links or ticket references (e.g. ADO, Jira) to include in the commit
> message, or type 'none'.

**WAIT.** Skip the ask only if step 5 already captured the ticket numbers — in that case, show
them and confirm.

## 7 — Commit and push — **HARD PAUSE before committing**

Show the staged file list for confirmation first (`git status --short`). Then compose the commit
deterministically — deciding the title, description and ticket list stays yours; the module only
builds the argv and enforces the guardrails:

```bash
node ~/.claude/skills/tooling/cli.mjs commit-composer.composeCommitArgs '[{"title":"<title>","description":"<description>","tickets":["<number>"]}]'
```

Ticket numbers go in bare (`"123"`, not `"#123"`) — the module prefixes each with `#` itself. An
empty `tickets` array omits the third `-m` flag entirely, matching this skill's exact instruction —
if the user said 'none', pass `"tickets": []` rather than an empty string. Feed the returned argv
to `formatCommand` for a properly quoted, human-readable approval string:

```bash
node ~/.claude/skills/tooling/cli.mjs commit-composer.formatCommand '[<argv from composeCommitArgs>]'
```

**Show the fully composed command and get approval before running it.** Then:

```bash
node ~/.claude/skills/tooling/cli.mjs commit-composer.runCommit '[".", <argv from composeCommitArgs>]'
node ~/.claude/skills/tooling/cli.mjs commit-composer.pushBranch '[".", "<new_branch>"]'
```

`runCommit` runs `git add -A` then the commit argv, never a shell. `pushBranch` throws *before
running anything* if `<new_branch>` is `main`/`master` or doesn't match the currently checked-out
branch — "never force-push, never push to main" is structurally unreachable here, not merely a
rule to remember; the function has no force-push parameter at all. Report the commit hash, the
push result, and any remote branch or PR URL git prints.

## 8 — Remove completed plans

```bash
node ~/.claude/skills/tooling/cli.mjs plan-pruning.scanPlansDir '[".claude/plans"]'
```

(the container's `.claude/plans` too, in a workspace). Reports every `FEATURE_PLAN_*.md` found,
each with `{"safe": bool, "reason"?, "pendingMilestones"?}` — `safe` compares the `(chosen)`
tier's milestone numbers in the plan itself against every `APPROVED | milestone=<N> |` line in its
companion `<Name>.ledger.md` (written by `/execute-plan` §6 on each hard-stop approval):

- **`safe: true`** → every milestone the chosen tier defines has a matching approval. The plan is
  finished. Delete both the plan and its ledger.
- **`safe: false`** → leave it alone, whatever the reason (`pending-approval` with the list of
  still-unapproved milestones, `no-ledger`, `no-chosen-tier`, or `malformed-plan`). It is live
  recovery state, not clutter, whether or not it relates to the branch just pushed — a
  `no-chosen-tier`/`malformed-plan` result means the plan predates this convention or is genuinely
  malformed, not that it's safe to guess about; leave those for a human to look at too.

Leave `.claude/reports/` untouched — this step only prunes `.claude/plans/`. These files are
gitignored per the pipeline contract and never reach the commit either way, so removing them is
pure workspace tidying, not something that changes what was just pushed. Runs automatically, no
hard pause — but state plainly which plans (if any) were removed, and which were left and why.

## 9 — Remove the consumed handoff document

Once the branch is committed and pushed, any handoff document written for this session's working
directory describes state that no longer exists — the work it was meant to hand off is now landed.

Locate it in `~/.claude/handoff/`: sanitize the absolute working directory path by replacing every
`:` and `\` with `-` (e.g. `C:\Users\Jason_Weiss\Projects\claude-skills` becomes
`C--Users-Jason-Weiss-Projects-claude-skills`), then look for `<sanitized>.md` and its sibling
`<sanitized>.requested` in that directory.

- **Either file exists** → delete whichever are present. The work they described is committed and
  pushed; there is nothing left to hand off.
- **Neither exists** → nothing to do, say so.

**Never touch another workspace's handoff files.** Match only the sanitized path for *this*
session's own working directory — every other `*.md`/`*.requested` pair in `~/.claude/handoff/`
belongs to a different project's in-progress or unread recovery state, and deleting one destroys
context that cannot be reconstructed.

Runs automatically, no hard pause — but state plainly whether a handoff document was removed.

## Guardrails

- **Never force-push.**
- **Never push to `main` or `master`.** The push targets the new feature branch, by its own name.
- Abort and surface the error if `git stash pop` fails unexpectedly, if this is not a git repo,
  or if the working-tree state is unclear.
- Only commit after showing the composed command and getting approval.
- `git add -A` stages everything — show the file list first so the user can catch stray artifacts
  before they land in the commit.

## Common mistakes

- Auto-resolving a stash conflict instead of asking. Step 4 is a hard pause for a reason.
- Running `git checkout` before the user has named the base branch.
- Committing without showing the composed command.
- **Taking one approval as consent to commit in several repos.** Confirm per repo, every time.
- **Using a different branch name per repo.** The shared name is what ties the set together.
- Attempting to unwind commits already pushed to other repos when one repo fails.
- Committing generated output in one repo without the source change that produced it.
- Overwriting `changes.md` instead of appending.
- Committing `changes.md` — it must stay gitignored.
- Skipping the drift preflight because "it's probably fine". It is free.
- Deleting a plan whose ledger isn't fully approved, or one with no ledger at all — step 8 removes
  only genuinely finished plans, never mid-flight or unstarted ones.
- Deleting a handoff document belonging to a different workspace than the one just committed —
  step 9 matches only this session's own sanitized working-directory path.

## End of the pipeline

This is the last stage. The branch is pushed; open the pull request from here.
