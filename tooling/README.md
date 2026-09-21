# tooling

Plain Node scripts that replace the codeable, non-judgment steps of the 6-skill Claude Code
pipeline (`map-codebase`, `plan-feature`, `execute-plan`, `test-feature`, `kevin`,
`cleanup-crew`) with deterministic code instead of re-derived-per-run prose interpretation. No
dependencies; Node 14.8+.

## complexity-scoring

`tooling/lib/complexity-scoring.mjs` is a machine-readable lookup module over
`tooling/config/complexity-scoring.json`, itself a transcription of `_shared/complexity-scoring.md`
— **which remains the prose source of truth**; the JSON and this module exist only so later
codeable-section plans can do model-tier lookups programmatically instead of re-parsing markdown.

Exports:
- `loadConfig()` — the parsed JSON config.
- `modelInfo(tier)` — model ID, context window, and prices for `'opus5' | 'sonnet5' | 'haiku45'`.
- `scoreBand(score)` — `'Low' | 'Medium' | 'High'` for a 1-10 overall score.
- `computeScore(factors)` — `{ scope, ambiguity, risk, uncertainty }` (each 1-10) averaged and
  rounded, ties rounding up.
- `modelForGate(gateName, score, opts)` — dispatch lookup across all four gate tables:
  - `modelForGate('featureLevel', score)`
  - `modelForGate('taskLevel', score)`
  - `modelForGate('gradingLevel', score, { mode })` — `mode` one of
    `'test-feature-low-optimism' | 'kevin-plan-or-domain' | 'test-feature-high-optimism'
    | 'kevin-e2e'`; `'test-feature-high-optimism'` also needs `score` (plan complexity),
    `'kevin-e2e'` needs `opts.domainCount` instead.
  - `modelForGate('mapLevel', score, { mode })` — `mode` one of
    `'fullBuildOrUpdate' | 'verify'`; `score` is ignored for this gate.

**Caveat on `.note` fields:** the `note` strings returned by `modelForGate` (most notably on
`taskLevel`'s bands) are verbatim transcriptions of `_shared/complexity-scoring.md`'s current
task-level table, which still describes subagent dispatch — language superseded by this repo's
active no-subagent policy. Callers must not treat `.note` as dispatch instructions. This will
resolve once roadmap item `subagent-strip-out` rewrites the source doc; the drift guard will then
force `complexity-scoring.json` to resync automatically.

A later plan imports what it needs, e.g.:

```js
import { modelForGate } from '../tooling/lib/complexity-scoring.mjs'
const { model } = modelForGate('taskLevel', taskScore)
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

## Running the tests

```
node tooling/run-tests.mjs
```
