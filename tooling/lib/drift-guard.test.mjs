// Fails if _shared/complexity-scoring.md's tables/rubric bands drift from the values
// transcribed into tooling/config/complexity-scoring.json's `_driftSnapshot`. Anchored on the
// exact `##` heading text (not line numbers) so unrelated edits elsewhere in the file don't
// trip it. On an intentional source change: update `_driftSnapshot` in the JSON to match.
import { test } from '../../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadConfig } from './complexity-scoring.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mdPath = join(__dirname, '..', '..', '_shared', 'complexity-scoring.md')

export function extractSection (mdText, headingText) {
  const lines = mdText.split('\n')
  const startIdx = lines.findIndex(l => l.trim() === headingText)
  if (startIdx === -1) throw new Error(`heading not found: ${headingText}`)
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { endIdx = i; break }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n')
}

export function extractPipeLines (sectionText) {
  return sectionText.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('|'))
    .join('\n')
}

export function extractBulletRangeLines (sectionText) {
  return sectionText.split('\n')
    .map(l => l.trim())
    .filter(l => /^-\s*\d+-\d+:/.test(l))
    .join('\n')
}

export function buildSnapshot (mdText) {
  return {
    modelReferenceTable: extractPipeLines(extractSection(mdText, '## Model reference')),
    fourFactorsBullets: extractBulletRangeLines(extractSection(mdText, '## The four factors')),
    featureLevelTable: extractPipeLines(extractSection(mdText, '## Feature-level use (plan-feature, at ingestion)')),
    taskLevelTable: extractPipeLines(extractSection(mdText, '## Task-level use (execute-plan, at decompose)')),
    gradingLevelTable: extractPipeLines(extractSection(mdText, '## Grading-level use (test-feature, kevin)')),
    mapLevelTable: extractPipeLines(extractSection(mdText, '## Map-level use (map-codebase)'))
  }
}

test('drift guard: _shared/complexity-scoring.md matches the stored snapshot', () => {
  const mdText = readFileSync(mdPath, 'utf8')
  const actual = buildSnapshot(mdText)
  const { _comment, ...expected } = loadConfig()._driftSnapshot
  assert.deepEqual(actual, expected,
    '_shared/complexity-scoring.md has drifted from tooling/config/complexity-scoring.json.\n' +
    'If this edit was intentional, update both the config values and _driftSnapshot to match.')
})
