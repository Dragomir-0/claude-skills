# Test Report — commit-composer
Plan: .claude/plans/FEATURE_PLAN_commit-composer.md   Optimism: 3   Generated: 2026-09-22

## Verdict
ship

## Passes
- `composeCommitArgs` builds the 3-flag shape with tickets and the 2-flag shape (third `-m`
  fully omitted, not empty) without tickets, matching the plan's exact spec. Special characters
  (quotes, backslash, newline) pass through argv untouched — verified.
- `formatCommand` is display-only; `runCommit` never routes execution through it, so there is no
  shell-quoting step in the execution path. Quoting/escaping for spaces and embedded quotes
  verified for the display string.
- `runCommit` stages with `git add -A` then commits via `execFileSync` (array argv, no shell —
  no injection surface). Failure path (nothing to commit) surfaces `stdout` as a fallback for
  `stderr`, correctly working around `git commit`'s failure text landing on stdout — verified
  against real git behavior in the test.
- `pushBranch`'s two guardrails are structurally enforced, not merely defaulted off:
  - `branchName === 'main' | 'master'` (case-sensitive, matching real git branch names) throws
    before any subprocess runs — verified via a spy-free assertion that no `execFileSync` call
    happens (bare-repo refs unchanged).
  - Current-checked-out-branch mismatch throws before pushing — verified against a real bare
    "origin" fixture; the mismatched branch never appears in the bare repo's refs afterward.
  - No force-push parameter exists in the function signature at all (checked by reading the
    source, not just the tests) — "never force-push" is unreachable by construction.
  - A real successful push (matching, non-protected branch) verified by inspecting the bare
    repo's refs afterward, not just the return value.
- `tooling/run-tests.mjs` correctly wires in the new test file (`import
  './lib/commit-composer.test.mjs'`).
- Full suite: **45 passed, 0 failed, 45 total** (`node tooling/run-tests.mjs`, re-verified this
  session — see Coverage below for the exact command output).
- Manual correctness pass (§7, `code-review`'s dimensions applied inline — the skill itself is
  disabled this session): no correctness bugs found in `commit-composer.mjs`. The `git()` helper
  duplicates `git-orchestration.mjs`'s pattern, but this is a plan-acknowledged, deliberate
  deferral (Tier 3 sketch: a shared `_git-exec.mjs`), not a new finding — not worth flagging
  again here.

## Warnings
- **`pushBranch`'s push-failure return path is untested.** `push.ok === false` → `{ ok: false,
  stderr: push.stderr || push.stdout }` (`tooling/lib/commit-composer.mjs:64`) has no test
  driving a real `git push` failure (e.g., diverged/rejected ref) and asserting the returned
  shape. Both guardrail-throw paths and the success path are well covered; only this one
  fail-open-safely branch is not. Low risk — the function still fails safe (no partial state,
  no force-push possible) even if the shape were subtly wrong — but worth a fast follow.
- **`runCommit`'s `git add -A` failure path is untested** (`commit-composer.mjs:44`,
  `if (!add.ok) return { ok: false, step: 'add', ... }`). Very low likelihood in practice (`git
  add -A` essentially only fails on repo corruption or permission errors), not blocking.
- Minor UX-only nit: if `git rev-parse --abbrev-ref HEAD` itself fails (e.g., unborn/detached
  HEAD with no ref), `current` becomes `''` and the thrown message reads "checked-out branch ()
  does not match branchName (...)" — correct fail-closed behavior, just a confusing empty value
  in the message. Not a safety issue.

## Critical Failures
None.

## Coverage
No coverage tool is configured for `tooling/` (a custom harness — `map-codebase/harness.mjs` —
not nyc/c8/istanbul); per §2, falling back to the plain test command with static reasoning over
which branches are exercised.

Command output:
```
$ node tooling/run-tests.mjs
45 passed, 0 failed, 45 total
```

Static branch coverage for `tooling/lib/commit-composer.mjs`:
- `composeCommitArgs` — Compliant (both branches: with/without tickets, both exercised).
- `formatCommand` — Compliant (plain-token and quote/escape branches both exercised).
- `runCommit` — Partial: success path and commit-failure path both tested; `add`-failure path
  (line 44) uncovered.
- `pushBranch` — Partial: both guardrail-throw branches and the push-success branch are tested;
  the push-failure branch (line 64) is uncovered.

No other files in the manifest (`tooling/run-tests.mjs`) carry logic beyond the added import.

## Correction Plan
1. [claude-skills] `tooling/lib/commit-composer.test.mjs` — add a test that drives a real push
   failure (e.g., push a branch whose remote ref already has a diverging commit, without
   `--force`) and asserts `pushBranch` returns `{ ok: false, stderr: <non-empty> }` rather than
   throwing, closing the coverage gap at `commit-composer.mjs:64`.
2. [claude-skills] `tooling/lib/commit-composer.test.mjs` — optionally add a test simulating a
   failing `git add -A` (e.g., pointing `root` at a path with no git repo) and assert `runCommit`
   returns `{ ok: false, step: 'add', ... }`, closing the coverage gap at `commit-composer.mjs:44`.
