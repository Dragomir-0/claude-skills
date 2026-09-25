import { test } from '../../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import { modelInfo, scoreBand, computeScore, modelForGate } from './complexity-scoring.mjs'

test('modelInfo returns correct data for both tiers', () => {
  assert.equal(modelInfo('opus5').id, 'claude-opus-5')
  assert.equal(modelInfo('sonnet5').id, 'claude-sonnet-5')
})

test('modelInfo throws on unknown tier', () => {
  assert.throws(() => modelInfo('gpt5'))
  assert.throws(() => modelInfo('haiku45'))
})

test('scoreBand boundaries: Low/Medium/High', () => {
  assert.equal(scoreBand(1), 'Low')
  assert.equal(scoreBand(3), 'Low')
  assert.equal(scoreBand(4), 'Medium')
  assert.equal(scoreBand(6), 'Medium')
  assert.equal(scoreBand(7), 'High')
  assert.equal(scoreBand(10), 'High')
})

test('computeScore averages the four factors', () => {
  assert.equal(computeScore({ scope: 1, ambiguity: 1, risk: 1, uncertainty: 1 }), 1)
  assert.equal(computeScore({ scope: 10, ambiguity: 10, risk: 10, uncertainty: 10 }), 10)
})

test('computeScore rounds ties up', () => {
  // average 5.5 -> 6
  assert.equal(computeScore({ scope: 5, ambiguity: 5, risk: 6, uncertainty: 6 }), 6)
})

test('computeScore rejects out-of-range factors', () => {
  assert.throws(() => computeScore({ scope: 0, ambiguity: 5, risk: 5, uncertainty: 5 }))
  assert.throws(() => computeScore({ scope: 11, ambiguity: 5, risk: 5, uncertainty: 5 }))
})

test('computeScore rejects non-number factors', () => {
  assert.throws(() => computeScore({ scope: '5', ambiguity: 5, risk: 5, uncertainty: 5 }))
})

test('scoreBand throws on out-of-range score', () => {
  assert.throws(() => scoreBand(0))
  assert.throws(() => scoreBand(11))
})

test('featureLevel gate boundary: 7 vs 8 switches sonnet5 -> opus5', () => {
  assert.equal(modelForGate('featureLevel', 7).model, 'sonnet5')
  assert.equal(modelForGate('featureLevel', 8).model, 'opus5')
})

test('taskLevel gate boundaries: 3 vs 4, 7 vs 8 return guidance, not a model', () => {
  assert.equal(modelForGate('taskLevel', 3).model, undefined)
  assert.match(modelForGate('taskLevel', 3).guidance, /Mechanical/)
  assert.match(modelForGate('taskLevel', 4).guidance, /Real judgment/)
  assert.match(modelForGate('taskLevel', 7).guidance, /Real judgment/)
  assert.match(modelForGate('taskLevel', 8).guidance, /controller alone/)
})

test('gradingLevel gate: test-feature-low-optimism is always sonnet5', () => {
  assert.equal(modelForGate('gradingLevel', null, { mode: 'test-feature-low-optimism' }).model, 'sonnet5')
})

test('gradingLevel gate: kevin-plan-or-domain is always sonnet5', () => {
  assert.equal(modelForGate('gradingLevel', null, { mode: 'kevin-plan-or-domain' }).model, 'sonnet5')
})

test('gradingLevel gate: test-feature-high-optimism boundary 7 vs 8', () => {
  assert.equal(modelForGate('gradingLevel', 7, { mode: 'test-feature-high-optimism' }).model, 'sonnet5')
  assert.equal(modelForGate('gradingLevel', 8, { mode: 'test-feature-high-optimism' }).model, 'opus5')
})

test('gradingLevel gate: kevin-e2e domain count boundary at 5 vs above 5', () => {
  assert.equal(modelForGate('gradingLevel', null, { mode: 'kevin-e2e', domainCount: 5 }).model, 'sonnet5')
  assert.equal(modelForGate('gradingLevel', null, { mode: 'kevin-e2e', domainCount: 6 }).model, 'opus5')
})

test('gradingLevel gate throws without opts.mode', () => {
  assert.throws(() => modelForGate('gradingLevel', 5))
})

test('gradingLevel gate throws for kevin-e2e without opts.domainCount', () => {
  assert.throws(() => modelForGate('gradingLevel', null, { mode: 'kevin-e2e' }))
})

test('gradingLevel gate throws on unrecognized mode', () => {
  assert.throws(() => modelForGate('gradingLevel', null, { mode: 'bogus-mode' }))
})

test('mapLevel gate: fullBuildOrUpdate is sonnet5, verify has no model', () => {
  assert.equal(modelForGate('mapLevel', null, { mode: 'fullBuildOrUpdate' }).model, 'sonnet5')
  assert.equal(modelForGate('mapLevel', null, { mode: 'verify' }).model, null)
})

test('mapLevel gate throws without opts.mode', () => {
  assert.throws(() => modelForGate('mapLevel', null))
})

test('mapLevel gate throws on unrecognized mode', () => {
  assert.throws(() => modelForGate('mapLevel', null, { mode: 'bogus-mode' }))
})

test('modelForGate throws on unknown gate name', () => {
  assert.throws(() => modelForGate('bogusGate', 5))
})
