# Test Report — complexity-scoring-config
Plan: .claude/plans/FEATURE_PLAN_complexity-scoring-config.md   Optimism: 3   Generated: 2026-09-21

Re-grade after correction round 1 (see `.claude/plans/complexity-scoring-config.ledger.md`'s
`CORRECTIONS | round=1` entry). Supersedes the prior report's verdict.

**Model floor:** plan Complexity 2/10 (Low) → grading-level table, `test-feature-low-optimism`
row → Sonnet 5 required, any plan complexity. This session runs on Sonnet 5. Floor met.

## Verdict
Ship.

## Passes

- All 6 (Tier 1) + 1 (Tier 2 drift-guard) manifest files present and match the plan's File Impact
  Manifest exactly; no extra or missing files.
- `node tooling/run-tests.mjs` → **22 passed, 0 failed, 22 total** (was 15 before round 1;
  +7 new error-branch tests, all green).
- Both round-1 corrections verified in place:
  1. `tooling/README.md` and `tooling/config/complexity-scoring.json`'s new `gates._notesCaveat`
     both state that `.note` fields mirror `_shared/complexity-scoring.md`'s still-subagent-laden
     task-level table and must not be treated as dispatch instructions until roadmap item
     `subagent-strip-out` lands.
  2. `tooling/lib/complexity-scoring.test.mjs` now covers `scoreBand`'s out-of-range throw,
     `computeScore`'s non-number-factor throw, and `modelForGate`'s missing-mode /
     missing-domainCount / unrecognized-mode branches for both `gradingLevel` and `mapLevel`.
- Confirmed the `_notesCaveat` addition needed no drift-guard resync: `drift-guard.test.mjs`'s
  `buildSnapshot()` (lines 40-49) extracts only raw pipe-table/bullet text from
  `_shared/complexity-scoring.md` into 6 named string fields; it never reads or diffs
  `config.gates.taskLevel[].note` or any other structured JSON field. `git status --porcelain` on
  `_shared/complexity-scoring.md` confirms it is still untouched.
- `modelForGate`'s dispatch is exercised at every boundary across all four gate tables
  (featureLevel 7/8, taskLevel 3/4 and 7/8, gradingLevel's four modes including the 7/8 and
  domainCount 5/6 boundaries, mapLevel's two modes), matching the plan's M2 testable criterion.
- No security, deployment, pipeline, or efficiency findings: pure Node/JSON lookup module, zero
  dependencies, no user input, no network or filesystem writes, all lookups over arrays of ≤5
  elements. No CI config exists in this repo to break.
- `tooling/README.md` accurately describes every exported function and the drift-guard's resync
  procedure; the round-1 caveat addition reads clearly in context.

## Warnings

1. **[claude-skills]** `pickBand` (`tooling/lib/complexity-scoring.mjs:38-42`)'s
   `if (!band) throw` branch is still untested. It's reachable only if `modelForGate` is called
   for `featureLevel`, `taskLevel`, or `gradingLevel`'s `test-feature-high-optimism` mode with a
   score outside 1-10 — every real call site sources `score` from `computeScore`, which already
   rejects out-of-range input before a score can reach `pickBand`, so this is defensive-only and
   non-blocking. Not part of round 1's Correction Plan; flagging for awareness, not requiring a
   round 2. Optional follow-up: `assert.throws(() => modelForGate('featureLevel', 11))`.

## Critical Failures

None.

## Coverage

No coverage tooling is configured for this module or its sibling `map-codebase/` (both use the
same dependency-free `harness.mjs`/`run-tests.mjs` pattern with no jest/vitest/c8/nyc instrumentation
— confirmed by reading both `package.json` files and `git ls-files map-codebase/`). This matches
the project's existing convention, so no gap here is specific to this feature. Falling back to
manual line/branch review of `tooling/lib/complexity-scoring.mjs` (the only file with non-trivial
logic; `drift-guard.test.mjs`'s own extraction logic is exercised by its single test and was
independently verified live against a deliberate edit during the original build):

- `loadConfig`, `modelInfo` (incl. unknown-tier throw), `scoreBand` (all 3 bands + both
  out-of-range throws), `computeScore` (average, tie-round-up, numeric-range throw,
  non-number throw) — fully exercised.
- `modelForGate` — all four gate names, all documented modes, and every documented error branch
  (missing `opts.mode` for `gradingLevel` and `mapLevel`, missing `opts.domainCount` for
  `kevin-e2e`, unrecognized mode for both, unknown gate name) — fully exercised.
- `pickBand`'s internal `if (!band)` throw — not exercised (Warning above).

Evidence: `node tooling/run-tests.mjs` → `22 passed, 0 failed, 22 total`.

## Cross-repo contract

N/A — single-repo change, nothing else in the repo imports this module yet (per the plan's own
Risks note).

## Correction Plan

None. Verdict is ship.
