import { test } from '../../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseLedgerApprovals,
  parseChosenTierMilestones,
  isSafeToDelete,
  scanPlansDir
} from './plan-pruning.mjs'

function tempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-pruning-'))
}

// A fixture plan mirroring this initiative's own real plan shape: both tiers present, a
// `**Chosen tier:**` line, and a `### Milestones` subsection under each `## Tier N` heading,
// with the same M1/M2 numbering repeated in both tiers.
function fixturePlan ({ chosenTier = 2 } = {}) {
  return `# FEATURE_PLAN_fixture

**Chosen tier:** Tier ${chosenTier} — Localized Optimization.

## Context

Some context text.

## Tier 1 — Status Quo

### File Impact Manifest

| Repo | Action | File | Why |
|---|---|---|---|

### Milestones

**M1 — First thing (Tier 1)**
- Some criteria.

**M2 — Second thing (Tier 1)**
- Some criteria.

## Tier 2 — Localized Optimization (chosen)

### File Impact Manifest

| Repo | Action | File | Why |
|---|---|---|---|

### Milestones

**M1 — First thing (Tier 2)**
- Some criteria.

**M2 — Second thing (Tier 2)**
- Some criteria.

**M3 — Third thing (Tier 2)**
- Some criteria.

## Tier 3 — Global Upgrade (sketch)

Sketch only, never chosen.

## Contingency

Some contingency text.
`
}

// ---------------------------------------------------------------- parseLedgerApprovals

test('parseLedgerApprovals returns an empty set for null ledgerText', () => {
  const approved = parseLedgerApprovals(null)
  assert.deepEqual([...approved], [])
})

test('parseLedgerApprovals extracts every APPROVED milestone number', () => {
  const ledger = [
    'STAT | task=1 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1200',
    'APPROVED | milestone=1 | by=user',
    'STAT | task=2 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=900',
    'APPROVED | milestone=2 | by=user'
  ].join('\n')
  const approved = parseLedgerApprovals(ledger)
  assert.deepEqual([...approved].sort(), [1, 2])
})

test('parseLedgerApprovals returns an empty set when no APPROVED lines are present', () => {
  const ledger = 'STAT | task=1 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=500'
  const approved = parseLedgerApprovals(ledger)
  assert.deepEqual([...approved], [])
})

// ---------------------------------------------------------------- parseChosenTierMilestones

test('parseChosenTierMilestones extracts only the chosen tier\'s milestone numbers', () => {
  const result = parseChosenTierMilestones(fixturePlan({ chosenTier: 2 }))
  assert.deepEqual(result, { tier: 2, milestones: [1, 2, 3] })
})

test('parseChosenTierMilestones extracts Tier 1\'s milestones when Tier 1 is chosen', () => {
  const result = parseChosenTierMilestones(fixturePlan({ chosenTier: 1 }))
  assert.deepEqual(result, { tier: 1, milestones: [1, 2] })
})

test('parseChosenTierMilestones reports no-chosen-tier when the Chosen tier line is missing', () => {
  const planText = fixturePlan({ chosenTier: 2 }).replace(/\*\*Chosen tier:\*\*.*\n/, '')
  const result = parseChosenTierMilestones(planText)
  assert.deepEqual(result, { error: 'no-chosen-tier' })
})

test('parseChosenTierMilestones reports malformed-plan when the chosen tier heading is missing', () => {
  const planText = fixturePlan({ chosenTier: 2 }).replace('## Tier 2 — Localized Optimization (chosen)', '## Something Else')
  const result = parseChosenTierMilestones(planText)
  assert.deepEqual(result, { error: 'malformed-plan' })
})

test('parseChosenTierMilestones reports malformed-plan when the Milestones subsection is missing', () => {
  const planText = fixturePlan({ chosenTier: 2 }).replace(
    /### Milestones\n\n\*\*M1 — First thing \(Tier 2\)\*\*[\s\S]*?(?=## Tier 3)/,
    ''
  )
  const result = parseChosenTierMilestones(planText)
  assert.deepEqual(result, { error: 'malformed-plan' })
})

test('parseLedgerApprovals dedupes duplicate APPROVED lines for the same milestone', () => {
  const ledger = [
    'APPROVED | milestone=1 | by=user',
    'APPROVED | milestone=1 | by=user'
  ].join('\n')
  const approved = parseLedgerApprovals(ledger)
  assert.deepEqual([...approved], [1])
})

// ---------------------------------------------------------------- isSafeToDelete

test('isSafeToDelete returns safe:true when every chosen-tier milestone is approved', () => {
  const planText = fixturePlan({ chosenTier: 2 })
  const ledgerText = [
    'APPROVED | milestone=1 | by=user',
    'APPROVED | milestone=2 | by=user',
    'APPROVED | milestone=3 | by=user'
  ].join('\n')
  const result = isSafeToDelete({ planText, ledgerText })
  assert.deepEqual(result, { safe: true })
})

test('isSafeToDelete returns no-ledger when ledgerText is null', () => {
  const planText = fixturePlan({ chosenTier: 2 })
  const result = isSafeToDelete({ planText, ledgerText: null })
  assert.deepEqual(result, { safe: false, reason: 'no-ledger' })
})

test('isSafeToDelete returns pending-approval with the sorted list of unapproved milestones', () => {
  const planText = fixturePlan({ chosenTier: 2 })
  const ledgerText = 'APPROVED | milestone=2 | by=user'
  const result = isSafeToDelete({ planText, ledgerText })
  assert.deepEqual(result, { safe: false, reason: 'pending-approval', pendingMilestones: [1, 3] })
})

test('isSafeToDelete passes through no-chosen-tier from parseChosenTierMilestones', () => {
  const planText = fixturePlan({ chosenTier: 2 }).replace(/\*\*Chosen tier:\*\*.*\n/, '')
  const result = isSafeToDelete({ planText, ledgerText: 'APPROVED | milestone=1 | by=user' })
  assert.deepEqual(result, { safe: false, reason: 'no-chosen-tier' })
})

test('isSafeToDelete passes through malformed-plan from parseChosenTierMilestones', () => {
  const planText = fixturePlan({ chosenTier: 2 }).replace('## Tier 2 — Localized Optimization (chosen)', '## Something Else')
  const result = isSafeToDelete({ planText, ledgerText: 'APPROVED | milestone=1 | by=user' })
  assert.deepEqual(result, { safe: false, reason: 'malformed-plan' })
})

// ---------------------------------------------------------------- scanPlansDir

test('scanPlansDir reports safe, pending, and missing-ledger plans from a real directory', () => {
  const dir = tempDir()

  fs.writeFileSync(path.join(dir, 'FEATURE_PLAN_Approved.md'), fixturePlan({ chosenTier: 2 }))
  fs.writeFileSync(path.join(dir, 'Approved.ledger.md'), [
    'APPROVED | milestone=1 | by=user',
    'APPROVED | milestone=2 | by=user',
    'APPROVED | milestone=3 | by=user'
  ].join('\n'))

  fs.writeFileSync(path.join(dir, 'FEATURE_PLAN_Partial.md'), fixturePlan({ chosenTier: 2 }))
  fs.writeFileSync(path.join(dir, 'Partial.ledger.md'), 'APPROVED | milestone=2 | by=user')

  fs.writeFileSync(path.join(dir, 'FEATURE_PLAN_NoLedger.md'), fixturePlan({ chosenTier: 2 }))

  const results = scanPlansDir(dir)
  assert.equal(results.length, 3)

  const byName = Object.fromEntries(results.map(r => [r.name, r]))

  assert.deepEqual(byName.Approved, {
    name: 'Approved',
    planPath: path.join(dir, 'FEATURE_PLAN_Approved.md'),
    ledgerPath: path.join(dir, 'Approved.ledger.md'),
    safe: true
  })

  assert.deepEqual(byName.Partial, {
    name: 'Partial',
    planPath: path.join(dir, 'FEATURE_PLAN_Partial.md'),
    ledgerPath: path.join(dir, 'Partial.ledger.md'),
    safe: false,
    reason: 'pending-approval',
    pendingMilestones: [1, 3]
  })

  assert.deepEqual(byName.NoLedger, {
    name: 'NoLedger',
    planPath: path.join(dir, 'FEATURE_PLAN_NoLedger.md'),
    ledgerPath: path.join(dir, 'NoLedger.ledger.md'),
    safe: false,
    reason: 'no-ledger'
  })
})
