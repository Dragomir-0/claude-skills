import { test } from '../../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import { formatSummaryTable } from './cross-repo-table.mjs'

test('formatSummaryTable: header and all-success rows', () => {
  const table = formatSummaryTable([
    { repo: 'claude-skills', branch: 'feature/foo', commit: 'abc1234', pushResult: 'pushed', prUrl: 'https://example.com/pr/1' },
    { repo: 'other-repo', branch: 'feature/bar', commit: 'def5678', pushResult: 'pushed', prUrl: 'https://example.com/pr/2' }
  ])
  const lines = table.split('\n')
  assert.equal(lines[0], '| Repo | Branch | Commit | Push | PR |')
  assert.equal(lines[1], '|---|---|---|---|---|')
  assert.equal(lines[2], '| claude-skills | feature/foo | abc1234 | pushed | https://example.com/pr/1 |')
  assert.equal(lines[3], '| other-repo | feature/bar | def5678 | pushed | https://example.com/pr/2 |')
  assert.equal(lines.length, 4)
})

test('formatSummaryTable: skipped row renders literal text, not specially formatted', () => {
  const table = formatSummaryTable([
    { repo: 'claude-skills', branch: 'feature/foo', commit: 'skipped', pushResult: 'skipped', prUrl: 'https://example.com/pr/1' }
  ])
  assert.equal(table.split('\n')[2], '| claude-skills | feature/foo | skipped | skipped | https://example.com/pr/1 |')
})

test('formatSummaryTable: aborted row renders literal text, not specially formatted', () => {
  const table = formatSummaryTable([
    { repo: 'claude-skills', branch: 'feature/foo', commit: 'aborted', pushResult: 'aborted', prUrl: 'https://example.com/pr/1' }
  ])
  assert.equal(table.split('\n')[2], '| claude-skills | feature/foo | aborted | aborted | https://example.com/pr/1 |')
})

test('formatSummaryTable: missing prUrl renders as em dash placeholder', () => {
  const table = formatSummaryTable([
    { repo: 'claude-skills', branch: 'feature/foo', commit: 'abc1234', pushResult: 'pushed' }
  ])
  assert.equal(table.split('\n')[2], '| claude-skills | feature/foo | abc1234 | pushed | — |')
})

test('formatSummaryTable: null and empty-string prUrl also render as placeholder', () => {
  const nullTable = formatSummaryTable([
    { repo: 'claude-skills', branch: 'feature/foo', commit: 'abc1234', pushResult: 'pushed', prUrl: null }
  ])
  const emptyTable = formatSummaryTable([
    { repo: 'claude-skills', branch: 'feature/foo', commit: 'abc1234', pushResult: 'pushed', prUrl: '' }
  ])
  assert.equal(nullTable.split('\n')[2], '| claude-skills | feature/foo | abc1234 | pushed | — |')
  assert.equal(emptyTable.split('\n')[2], '| claude-skills | feature/foo | abc1234 | pushed | — |')
})

test('formatSummaryTable: row missing a required field throws, naming index and field', () => {
  assert.throws(
    () => formatSummaryTable([
      { repo: 'claude-skills', branch: 'feature/foo', commit: 'abc1234', pushResult: 'pushed' },
      { branch: 'feature/bar', commit: 'def5678', pushResult: 'pushed' }
    ]),
    /row 1 is missing required field "repo"/
  )
})

test('formatSummaryTable: each required field is checked, not just "repo"', () => {
  assert.throws(
    () => formatSummaryTable([{ repo: 'claude-skills', branch: 'feature/foo', commit: 'abc1234' }]),
    /row 0 is missing required field "pushResult"/
  )
})

test('formatSummaryTable: empty rows array produces header only', () => {
  const table = formatSummaryTable([])
  assert.equal(table, '| Repo | Branch | Commit | Push | PR |\n|---|---|---|---|---|')
})
