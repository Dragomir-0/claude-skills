# Test Report — plan-pruning
Plan: .claude/plans/FEATURE_PLAN_plan-pruning.md   Optimism: 3   Generated: 2026-09-22

## Verdict
ship

## Passes
- `parseLedgerApprovals(ledgerText)` — `null` returns an empty set, multiple `APPROVED |
  milestone=<N> |` lines are extracted correctly, absence of any such line returns an empty set,
  and duplicate lines for the same milestone dedupe via `Set` — verified with a dedicated test per
  the plan's Tier 2 requirement, not left as an unverified side effect of the data structure.
- `parseChosenTierMilestones(planText)` — correctly scopes extraction to the chosen tier's own
  `### Milestones` subsection (verified against a fixture with identical `**M1 —**`/`**M2 —**`
  numbering repeated in both Tier 1 and Tier 2, matching this initiative's real plan shape), picks
  up Tier 1's milestones when Tier 1 is chosen instead, and reports `no-chosen-tier` /
  `malformed-plan` (missing tier heading, missing `### Milestones` subsection) instead of throwing
  or guessing — matching the plan's Tier 2 graceful-handling requirement.
- `isSafeToDelete({ planText, ledgerText })` — `safe: true` when every chosen-tier milestone is
  approved, `{ safe: false, reason: 'no-ledger' }` when `ledgerText` is `null`, `{ safe: false,
  reason: 'pending-approval', pendingMilestones: [...] }` with the correct sorted list when some
  are unapproved, and correctly passes through both `parseChosenTierMilestones` error reasons.
- `scanPlansDir(plansDir)` — verified against a real temp directory (`fs.mkdtempSync`, not mocked)
  containing three `FEATURE_PLAN_<Name>.md` + `<Name>.ledger.md` pairs (fully-approved,
  partially-approved, no-ledger-at-all); asserts the full `{ name, planPath, ledgerPath, safe,
  reason?, pendingMilestones? }` shape for all three. Confirmed report-only — no `fs.unlink`,
  `fs.rm`, or any mutating call anywhere in the module.
- Full suite: **68 passed, 0 failed, 68 total** (`node tooling/run-tests.mjs`, re-verified this
  session — up from 61 before this milestone, i.e. exactly the 7 new M2 tests, no regressions).
- Manual correctness pass (§7, `code-review`'s dimensions applied inline — the skill itself is
  disabled this session): no correctness bugs found. No injection surface (no shell, no
  interpolated commands) — pure `fs.readdirSync`/`fs.readFileSync`/`fs.existsSync` calls with a
  caller-supplied `plansDir`, same trust model as the rest of `tooling/lib/`. Regex use of `\b`
  after the tier number in `parseChosenTierMilestones` correctly prevents "Tier 1" from matching
  inside "Tier 10"-style headings.

## Warnings
- **One untested static branch** in `parseChosenTierMilestones`: the `milestones.length === 0`
  guard (`plan-pruning.mjs:50`) — reached when a chosen tier's `### Milestones` heading exists but
  no `**M<N> —` lines follow before the next `## ` heading (an empty milestones section). The
  existing "missing Milestones subsection" test removes the heading itself, so it exercises the
  earlier `!milestonesHeadingMatch` branch (line 46), not this one. Low risk — this shape (heading
  present, zero milestone lines) is unlikely from a real plan file, and the fallback behavior
  (`malformed-plan`) is the same safe result either way — but the branch itself has no dedicated
  test.
- Same cross-cutting risk the plan itself calls out: this module is only useful once
  `execute-plan/SKILL.md` §8 is separately updated to actually write the `APPROVED |
  milestone=<N> | by=user` marker (not in this plan's scope, already flagged to the user in the
  plan's Context section). Until then `scanPlansDir` will correctly, safely report every real
  plan as `pending-approval`.

## Critical Failures
None.

## Coverage
No coverage tool is configured for `tooling/` (custom harness — `map-codebase/harness.mjs` — not
nyc/c8/istanbul); per §2, falling back to the plain test command with static reasoning over which
branches are exercised.

Command output:
```
$ node tooling/run-tests.mjs
68 passed, 0 failed, 68 total
```

Static branch coverage for `tooling/lib/plan-pruning.mjs`:
- `parseLedgerApprovals` — Compliant: null, multi-match, no-match, and duplicate-line branches all
  directly tested.
- `parseChosenTierMilestones` — Partial: no-chosen-tier, missing-tier-heading, missing-Milestones-
  heading, and both tiers' happy-path extraction are all tested; the zero-milestones-found branch
  (line 50) is not directly tested (see Warnings).
- `isSafeToDelete` — Compliant: safe:true, no-ledger, pending-approval (with correct pending
  list), and both error-passthrough branches all directly tested.
- `scanPlansDir` — Compliant: all three report shapes (safe, pending-approval, no-ledger) verified
  against a real temp directory.

No other files in the manifest (`tooling/run-tests.mjs`) carry logic beyond the added import.

## Correction Plan
1. [claude-skills] `tooling/lib/plan-pruning.mjs` — add a test to `plan-pruning.test.mjs` covering
   a chosen tier whose `### Milestones` heading is present but contains zero `**M<N> —` lines,
   asserting `{ error: 'malformed-plan' }`, closing the one untested static branch noted above.
