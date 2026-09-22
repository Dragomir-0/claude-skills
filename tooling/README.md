# tooling

Plain Node scripts that replace the codeable, non-judgment steps of the 6-skill Claude Code
pipeline (`map-codebase`, `plan-feature`, `execute-plan`, `test-feature`, `kevin`,
`cleanup-crew`) with deterministic code instead of re-derived-per-run prose interpretation. No
dependencies; Node 14.8+.

## Invoking from a skill

Every skill runs against an arbitrary target repo, not this one, so it can't `import` these
modules by a relative path the way the test files do. Once this repo is synced to
`~/.claude/skills/` (see the root README's install steps — `tooling/` copies over the same way the
six skill directories do), a skill invokes one exported function via the CLI dispatcher, the same
fixed-install-path convention `map-codebase` already uses for `map.mjs`:

```bash
node ~/.claude/skills/tooling/cli.mjs <module>.<export> '[...jsonArgs]'
```

`<module>` is one of the module names below (the `.mjs` filename minus its extension, `changelog`
for `changelog.mjs`). The JSON array is spread as positional arguments; a single non-array value is
wrapped in one automatically. Prints the JSON-stringified return value to stdout and exits 0, or
prints an error to stderr and exits 1 — a thrown error from the underlying module is never
swallowed. See `tooling/cli.mjs` and `tooling/cli.test.mjs` for the dispatcher itself.

## complexity-scoring

`tooling/lib/complexity-scoring.mjs` is a machine-readable lookup module over
`tooling/config/complexity-scoring.json`, itself a transcription of `_shared/complexity-scoring.md`
— **which remains the prose source of truth**; the JSON and this module exist only so later
codeable-section plans can do model-tier lookups programmatically instead of re-parsing markdown.

Exports:
- `loadConfig()` — the parsed JSON config.
- `modelInfo(tier)` — model ID for `'opus5' | 'sonnet5'`.
- `scoreBand(score)` — `'Low' | 'Medium' | 'High'` for a 1-10 overall score.
- `computeScore(factors)` — `{ scope, ambiguity, risk, uncertainty }` (each 1-10) averaged and
  rounded, ties rounding up.
- `modelForGate(gateName, score, opts)` — lookup across all four gate tables. `featureLevel`,
  `gradingLevel` and `mapLevel` gate the interactive session's own model and return `{ model,
  note? }`; `taskLevel` never gated a model (nothing is ever dispatched) and returns `{ guidance }`
  instead — how much verification rigor the task score calls for.
  - `modelForGate('featureLevel', score)`
  - `modelForGate('taskLevel', score)` — `{ guidance }`, not `{ model }`
  - `modelForGate('gradingLevel', score, { mode })` — `mode` one of
    `'test-feature-low-optimism' | 'kevin-plan-or-domain' | 'test-feature-high-optimism'
    | 'kevin-e2e'`; `'test-feature-high-optimism'` also needs `score` (plan complexity),
    `'kevin-e2e'` needs `opts.domainCount` instead.
  - `modelForGate('mapLevel', score, { mode })` — `mode` one of
    `'fullBuildOrUpdate' | 'verify'`; `score` is ignored for this gate.

A later plan imports what it needs, e.g.:

```js
import { modelForGate } from '../tooling/lib/complexity-scoring.mjs'
const { guidance } = modelForGate('taskLevel', taskScore)
```

### Drift guard

`tooling/lib/drift-guard.test.mjs` re-extracts the model reference table, the four-factor rubric
bands, and all four gate tables from `_shared/complexity-scoring.md`, and fails with a diff if
they no longer match the `_driftSnapshot` block stored in `tooling/config/complexity-scoring.json`.
This exists because ~14 later plans will depend on the JSON staying truthful to the markdown, and
a silent desync there would be worse than a loud one.

**If you intentionally edit a table or rubric band in `_shared/complexity-scoring.md`:** update
the matching value(s) in `complexity-scoring.json`, then regenerate `_driftSnapshot` by running:

```
node -e "import('./tooling/lib/drift-guard.test.mjs').then(async m => { const { readFileSync } = await import('node:fs'); console.log(JSON.stringify(m.buildSnapshot(readFileSync('./_shared/complexity-scoring.md', 'utf8')), null, 2)) })"
```

and paste the result over `_driftSnapshot` in the JSON (keep its `_comment` key).

## git-orchestration

`tooling/lib/git-orchestration.mjs` — mechanical git sequencing for `cleanup-crew` steps 1-4.
Never resolves a conflict, never runs `git stash drop`, never auto-picks a side; only detects and
reports, so the two hard pauses stay with the human/Claude side.

Exports (each takes `root` first):
- `statusShort(root)` — `{ clean, entries: [{status, path}] }` from `git status --porcelain`.
- `stashPush(root)` — `{ stashed, message }`; `git stash push -u`. `stashed: false` means nothing
  needed stashing.
- `checkoutAndPull(root, baseBranch)` — `{ ok }` or `{ ok: false, step: 'checkout'|'pull', stderr
  }`. Pre-checks upstream existence via plumbing before ever invoking `pull`, so a repo with no
  tracking branch fails fast with a named step instead of an opaque subprocess error.
- `createBranch(root, name)` — `{ ok }` or `{ ok: false, stderr }`; `git checkout -b <name>`.
- `stashPop(root)` — `{ conflict, conflictedFiles, raw }`. `conflictedFiles` comes from a fresh
  `git status --porcelain` scan for unmerged codes (`UU`/`AA`/`DD`/`AU`/`UA`/`UD`/`DU`) — stable
  across git versions/locales, never parsed from `stash pop`'s human-readable stdout.

## commit-composer

`tooling/lib/commit-composer.mjs` — mechanical commit composition and guarded push for
`cleanup-crew` step 7. Deciding the title, description and ticket list stays with Claude/the user;
this module only builds the argv and enforces the two guardrails.

Exports:
- `composeCommitArgs({ title, description, tickets })` — pure. Builds the `git commit` argv; the
  third `-m` (tickets, each prefixed with `#`) is omitted entirely, not passed empty, when
  `tickets` has no entries.
- `formatCommand(argv)` — pure. Properly quoted, human-readable display string for the approval
  step only — execution never goes through this string.
- `runCommit(root, argv)` — `git add -A` then `argv`, straight through `execFileSync`, never a
  shell. Returns `{ ok }` or `{ ok: false, step: 'add'|'commit', stderr }`.
- `pushBranch(root, branchName)` — `git push -u origin <branchName>`. **Throws before running
  anything** if `branchName` is `main`/`master` (case-sensitive) or doesn't match the currently
  checked-out branch. Has no force-push parameter at all — "never force-push" is structurally
  unreachable, not merely defaulted off.

## changelog

`tooling/lib/changelog.mjs` — mechanical `changes.md` gitignore + append-only entry helper for
`cleanup-crew` step 5. Deciding what the bullets say stays with Claude/the user; this module only
ensures the gitignore entry exists and appends correctly formatted, never-overwriting entries.

Exports:
- `ensureGitignored(root, filename = 'changes.md')` — idempotent; checks for an exact line match
  before appending, so calling it twice never duplicates the entry.
- `appendEntry(root, { date, tickets, bullets }, filename = 'changes.md')` — appends one dated
  entry (`## <date> — <tickets>` then one `- <bullet>` per line). Never truncates or rewrites
  existing content; guards against a missing trailing newline so the new entry never glues onto
  the previous line.

## plan-pruning

`tooling/lib/plan-pruning.mjs` — report-only scanner for `cleanup-crew` step 8: which finished
`FEATURE_PLAN_*.md` files (plus their ledgers) are safe to delete because every milestone in the
chosen tier has an `APPROVED` line in the ledger. **Never deletes anything itself.**

The chosen tier is identified by the `(chosen)` marker `plan-feature`'s "Approval and write" step
appends to that tier's own `## Tier <N>` heading (`(selected)` is also accepted, for one early plan
in this repo written before that wording was standardized) — there is no separate "Chosen tier"
line in a real plan. Milestone approval comes from `execute-plan` §6, which appends `APPROVED |
milestone=<N> | by=user` to the ledger on each hard-stop approval.

Exports:
- `parseLedgerApprovals(ledgerText)` — the `Set` of approved milestone numbers; `null` → empty set.
- `parseChosenTierMilestones(planText)` — `{ tier, milestones }`, or `{ error: 'no-chosen-tier' |
  'malformed-plan' }`. Never throws, never guesses a tier.
- `isSafeToDelete({ planText, ledgerText })` — `{ safe: true }`, or `{ safe: false, reason,
  pendingMilestones? }` (`reason` is one of the two parse errors above, `'no-ledger'`, or
  `'pending-approval'`).
- `scanPlansDir(plansDir)` — the only fs-touching export. Globs `FEATURE_PLAN_*.md`, finds each
  sibling `<Name>.ledger.md`, and reports `isSafeToDelete` for every pair.

## cross-repo-table

`tooling/lib/cross-repo-table.mjs` — formats the "repo, branch, commit hash, push result, PR URL"
summary table `cleanup-crew`'s cross-repo mode reports at the end of a run. Pure formatting, no
side effects.

- `formatSummaryTable(rows)` — pure. `rows: [{ repo, branch, commit, pushResult, prUrl }]` →
  markdown table string. `commit`/`pushResult` may literally be `"skipped"` or `"aborted"` for a
  repo that didn't make it, rendered as plain text, so partial completion reads clearly rather than
  needing special-casing. A missing `prUrl` renders as `—`. A row missing `repo`/`branch`/`commit`/
  `pushResult` throws, naming the row and the missing field.

## Running the tests

```
node tooling/run-tests.mjs
```
