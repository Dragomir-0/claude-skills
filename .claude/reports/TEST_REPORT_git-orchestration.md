# Test Report — git-orchestration
Plan: .claude/plans/FEATURE_PLAN_git-orchestration.md   Optimism: 3   Generated: 2026-09-21

Model floor check: plan Complexity 3/10 (Low) → any-complexity row of the grading-level table
requires Sonnet 5 for optimism 1-3. Session is Sonnet 5. Meets floor.

## Verdict
ship

## Passes
- All five Tier-2 functions (`statusShort`, `stashPush`, `checkoutAndPull` with upstream
  pre-check, `createBranch`, `stashPop`) implemented exactly per the plan's Tier 2 File Impact
  Manifest and Behavior section.
- `checkoutAndPull`'s upstream pre-check (`git rev-parse --abbrev-ref --symbolic-full-name
  <base>@{u}`) is proven to short-circuit before ever invoking `git pull` — the test asserts the
  exact pre-check error string, not git's own pull-failure text, which would differ if the
  fast-path weren't taken.
- `stashPop`'s conflict detection uses only `git status --porcelain` codes
  (`UU/AA/DD/AU/UA/UD/DU`), never parses `stash pop`'s human-readable stdout — matches the
  locale/version-independence goal stated in the plan's Risks section.
- `stashPop` never calls `git stash drop` under any code path (grepped the module — no
  occurrence) — matches the explicit non-goal in the plan's Context section.
- Real-git-repo test fixtures throughout (temp dirs via `fs.mkdtempSync` + real `execFileSync`
  git calls), including a genuine local bare repo as "origin" for the pull path and a genuine
  two-branch merge conflict for `stashPop` — nothing mocked, matching `map-codebase/test-map.mjs`'s
  established fixture pattern this plan cites.
- `tooling/run-tests.mjs` wired in (`import './lib/git-orchestration.test.mjs'`); full suite green.
- No shell-injection surface: every git invocation goes through `execFileSync('git', args, ...)`
  with an argv array, never a shell string.

## Warnings
- `stashPop` always re-runs `statusShort` after `git stash pop` regardless of whether the pop
  itself succeeded (e.g. "no stash entries to pop"). In that case it still returns
  `{ conflict: false, conflictedFiles: [], raw: <git's error text> }` — indistinguishable from a
  genuine clean pop except by string-matching `raw`, which is exactly the locale-parsing risk the
  module avoids everywhere else. Matches the plan's stated return shape verbatim (no `popped`/`ok`
  field was ever specified), so not a completeness defect — flagging for awareness if a future
  caller (the not-yet-built cleanup-crew driver) needs to distinguish the two cases.
- The `raw: r.stdout || r.stderr` fallback's stderr-only branch (stdout empty, stderr non-empty)
  is not proven to be exercised by either new test — both the clean-pop and conflict fixtures
  produce non-empty stdout from git, so the `|| r.stderr` half of that line is coverage-theatre-
  adjacent (present but unverified as reachable with real output). Low risk: one-line fallback,
  not a computed value.

## Critical Failures
None.

## Coverage
No coverage tool is configured for `tooling/` (no `c8`/`nyc`/`.nycrc`, no `--coverage` flag wired
into `npm test`) and none was added by this change — falling back to the real test-command output
plus static line-by-line reasoning per §3, labeled as an estimate, not a measurement.

Command output (`cd tooling && npm test`):
```
> test
> node run-tests.mjs

33 passed, 0 failed, 33 total
```
(22 pre-existing from `complexity-scoring`/`drift-guard`, 9 already-approved M1 tests, 2 new M2
tests: `stashPop applies cleanly...`, `stashPop reports conflict...`.)

Static assessment of `tooling/lib/git-orchestration.mjs` (changed file, this milestone's new code):
- `stashPop` (new): both branches of `conflict` (true/false) exercised; `UNMERGED_CODES` matching
  exercised via the real conflict fixture (`a.txt` reported with code `UU`). **Partial** — the
  `raw: r.stdout || r.stderr` stderr-only fallback not provably exercised (see Warnings).
- `statusShort`, `stashPush`, `checkoutAndPull`, `createBranch`, `hasUpstream`, `run` (from M1,
  unchanged this milestone): previously exercised by M1's 9 tests, still passing unchanged.

No other files in this item's diff carry executable logic (`run-tests.mjs`'s change is a single
import line).

## Correction Plan
None — verdict is ship. The two Warnings above are non-blocking observations, not required fixes.
