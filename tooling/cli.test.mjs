import { test } from '../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseSpec, parseArgs } from './cli.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cli = join(__dirname, 'cli.mjs')

const run = (args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' }).toString().trim()
const runExpectFail = (args) => {
  try {
    execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' })
    throw new Error('expected the CLI to exit non-zero')
  } catch (e) {
    if (e.status === undefined) throw e
    return e.stderr.toString()
  }
}

test('parseSpec splits module.export', () => {
  assert.deepEqual(parseSpec('complexity-scoring.modelForGate'), { moduleName: 'complexity-scoring', fnName: 'modelForGate' })
  assert.equal(parseSpec('no-dot'), null)
  assert.equal(parseSpec(undefined), null)
})

test('parseArgs JSON-decodes an array, wraps a bare value, defaults to empty', () => {
  assert.deepEqual(parseArgs('["featureLevel", 8]'), ['featureLevel', 8])
  assert.deepEqual(parseArgs('{"a":1}'), [{ a: 1 }])
  assert.deepEqual(parseArgs(undefined), [])
})

test('CLI: complexity-scoring.modelForGate returns the gate result as JSON', () => {
  const out = run(['complexity-scoring.modelForGate', '["featureLevel", 8]'])
  assert.deepEqual(JSON.parse(out), { model: 'opus5', note: 'no subagents' })
})

test('CLI: taskLevel gate returns guidance, not a model', () => {
  const out = run(['complexity-scoring.modelForGate', '["taskLevel", 2]'])
  const parsed = JSON.parse(out)
  assert.equal(parsed.model, undefined)
  assert.match(parsed.guidance, /Mechanical/)
})

test('CLI: a function needing no args runs with the argsJson positional omitted', () => {
  const out = run(['complexity-scoring.loadConfig'])
  const parsed = JSON.parse(out)
  assert.ok(parsed.models.opus5.id)
})

test('CLI: pure formatting function — cross-repo-table.formatSummaryTable', () => {
  const rows = [{ repo: 'api', branch: 'feature/x', commit: 'abc123', pushResult: 'ok', prUrl: null }]
  const out = run(['cross-repo-table.formatSummaryTable', JSON.stringify([rows])])
  assert.match(JSON.parse(out), /\| api \| feature\/x \| abc123 \| ok \| — \|/)
})

test('CLI: unknown module name exits non-zero with a clear message', () => {
  const stderr = runExpectFail(['bogus-module.fn', '[]'])
  assert.match(stderr, /unknown module: bogus-module/)
})

test('CLI: unknown export name exits non-zero with a clear message', () => {
  const stderr = runExpectFail(['complexity-scoring.bogusFn', '[]'])
  assert.match(stderr, /unknown export: complexity-scoring\.bogusFn/)
})

test('CLI: missing spec (no dot) exits non-zero with usage', () => {
  const stderr = runExpectFail([])
  assert.match(stderr, /usage: node cli\.mjs/)
})

test('CLI: a thrown error from the underlying module surfaces, not swallowed', () => {
  const stderr = runExpectFail(['complexity-scoring.modelForGate', '["featureLevel", 99]'])
  assert.match(stderr, /score out of range/)
})
