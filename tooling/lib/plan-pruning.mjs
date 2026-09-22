// plan-pruning.mjs — report-only scanner for cleanup-crew step 8: which finished FEATURE_PLAN
// files (plus their ledgers) are safe to delete because every milestone in the chosen tier has
// been approved. Never deletes anything itself — the caller decides what to do with the report.
import fs from 'node:fs'
import path from 'node:path'

/**
 * Regex-extracts every `APPROVED | milestone=<N>` line from ledger text and returns the set of
 * approved milestone numbers. `ledgerText === null` (no ledger file) returns an empty set.
 * Duplicate lines for the same milestone collapse naturally, since approvals collect into a Set.
 */
export function parseLedgerApprovals (ledgerText) {
  const approved = new Set()
  if (ledgerText === null) return approved
  for (const match of ledgerText.matchAll(/^APPROVED\s*\|\s*milestone=(\d+)\s*\|/gm)) {
    approved.add(Number(match[1]))
  }
  return approved
}

/**
 * Reads the `(chosen)` marker `plan-feature` appends to the chosen tier's own `## Tier <N>`
 * heading to find which tier was actually approved, then extracts the milestone numbers listed
 * under that tier's own `### Milestones` subsection only — scoped between that heading and the
 * next `## ` heading, not the whole file (every plan carries milestones under both Tier 1 and
 * Tier 2 with the same `**M1 —**` numbering, and only the chosen tier's milestones are the ones
 * execute-plan actually runs). Real plans mark the choice this way, not with a separate
 * `**Chosen tier:**` line — this must stay in sync with `plan-feature`'s "Approval and write"
 * section, the only other place that convention is written down. `(selected)` is also accepted —
 * one early plan in this repo used that wording before `(chosen)` was standardized.
 *
 * Returns `{ tier, milestones }` on success, or `{ error: 'no-chosen-tier' | 'malformed-plan' }`
 * when no tier heading carries the marker or its Milestones section can't be located — never
 * throws and never silently guesses a tier.
 */
export function parseChosenTierMilestones (planText) {
  const chosenHeadingMatch = planText.match(/^## Tier (\d+)\b.*\((?:chosen|selected)\).*$/m)
  if (!chosenHeadingMatch) return { error: 'no-chosen-tier' }
  const tierNum = Number(chosenHeadingMatch[1])

  const afterHeading = planText.slice(chosenHeadingMatch.index + chosenHeadingMatch[0].length)
  const nextHeadingMatch = afterHeading.match(/^## /m)
  const tierSection = nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading

  const milestonesHeadingMatch = tierSection.match(/^### Milestones\s*$/m)
  if (!milestonesHeadingMatch) return { error: 'malformed-plan' }
  const milestonesSection = tierSection.slice(milestonesHeadingMatch.index)

  const milestones = [...milestonesSection.matchAll(/^\*\*M(\d+)\s*—/gm)].map(m => Number(m[1]))
  if (milestones.length === 0) return { error: 'malformed-plan' }

  return { tier: tierNum, milestones }
}

/**
 * Pure function. Compares the chosen tier's milestone-number set against the ledger's approval
 * set. Returns `{ safe: true }` when every milestone has a matching approval, or
 * `{ safe: false, reason, pendingMilestones? }` otherwise — reasons are `'no-chosen-tier'` /
 * `'malformed-plan'` (from parseChosenTierMilestones), `'no-ledger'` (ledgerText is null), or
 * `'pending-approval'` (with the sorted list of still-unapproved milestone numbers).
 */
export function isSafeToDelete ({ planText, ledgerText }) {
  const parsed = parseChosenTierMilestones(planText)
  if (parsed.error) return { safe: false, reason: parsed.error }

  if (ledgerText === null) return { safe: false, reason: 'no-ledger' }

  const approved = parseLedgerApprovals(ledgerText)
  const pendingMilestones = parsed.milestones.filter(n => !approved.has(n)).sort((a, b) => a - b)
  if (pendingMilestones.length > 0) {
    return { safe: false, reason: 'pending-approval', pendingMilestones }
  }

  return { safe: true }
}

/**
 * The only fs-touching function. Globs `FEATURE_PLAN_*.md` in `plansDir`, derives `<Name>` from
 * each filename, looks for a sibling `<Name>.ledger.md` (absent -> `null` ledgerText), and
 * reports `isSafeToDelete` for each pair. Never deletes anything itself — report-only.
 */
export function scanPlansDir (plansDir) {
  const files = fs.readdirSync(plansDir).filter(f => /^FEATURE_PLAN_.*\.md$/.test(f))

  return files.map(file => {
    const name = file.slice('FEATURE_PLAN_'.length, -'.md'.length)
    const planPath = path.join(plansDir, file)
    const ledgerPath = path.join(plansDir, `${name}.ledger.md`)

    const planText = fs.readFileSync(planPath, 'utf8')
    const ledgerText = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : null

    const result = isSafeToDelete({ planText, ledgerText })
    return { name, planPath, ledgerPath, ...result }
  })
}
