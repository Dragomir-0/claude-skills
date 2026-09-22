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

## Running the tests

```
node tooling/run-tests.mjs
```
