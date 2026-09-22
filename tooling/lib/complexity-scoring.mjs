// Lookup module over tooling/config/complexity-scoring.json — the machine-readable mirror of
// _shared/complexity-scoring.md. Never hardcode a value here; read it from the config.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = join(__dirname, '..', 'config', 'complexity-scoring.json')

export function loadConfig () {
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

export function modelInfo (tier, config = loadConfig()) {
  const info = config.models[tier]
  if (!info) throw new Error(`unknown model tier: ${tier}`)
  return info
}

export function scoreBand (overallScore, config = loadConfig()) {
  const band = config.scoreBands.find(b => overallScore >= b.min && overallScore <= b.max)
  if (!band) throw new Error(`score out of range: ${overallScore}`)
  return band.label
}

export function computeScore (factors) {
  const { scope, ambiguity, risk, uncertainty } = factors
  const values = [scope, ambiguity, risk, uncertainty]
  for (const v of values) {
    if (typeof v !== 'number' || v < 1 || v > 10) {
      throw new Error(`factor values must be numbers 1-10, got: ${JSON.stringify(factors)}`)
    }
  }
  const average = values.reduce((a, b) => a + b, 0) / values.length
  return Math.round(average)
}

function pickBand (bands, score) {
  const band = bands.find(b => score >= b.min && score <= b.max)
  if (!band) throw new Error(`score out of range for gate: ${score}`)
  return { model: band.model, note: band.note }
}

function pickGuidanceBand (bands, score) {
  const band = bands.find(b => score >= b.min && score <= b.max)
  if (!band) throw new Error(`score out of range for gate: ${score}`)
  return { guidance: band.guidance }
}

// gateName: 'featureLevel' | 'taskLevel' | 'gradingLevel' | 'mapLevel'
// score: required for featureLevel/taskLevel, and for gradingLevel mode 'test-feature-high-optimism'
// opts.mode: required for gradingLevel and mapLevel gates (mode-keyed, not pure score lookups)
// opts.domainCount: required for gradingLevel mode 'kevin-e2e'
//
// featureLevel returns { model, note } — it gates the interactive session's own model.
// taskLevel returns { guidance } only — execute-plan never dispatches, so a task score feeds
// verification rigor, not a model choice.
export function modelForGate (gateName, score, opts = {}, config = loadConfig()) {
  const gate = config.gates[gateName]
  if (!gate) throw new Error(`unknown gate: ${gateName}`)

  if (gateName === 'featureLevel') {
    return pickBand(gate, score)
  }

  if (gateName === 'taskLevel') {
    return pickGuidanceBand(gate, score)
  }

  if (gateName === 'gradingLevel') {
    const { mode, domainCount } = opts
    if (!mode) throw new Error('gradingLevel gate requires opts.mode')
    if (mode === 'test-feature-high-optimism') {
      return pickBand(gate[mode], score)
    }
    if (mode === 'kevin-e2e') {
      if (typeof domainCount !== 'number') throw new Error('kevin-e2e mode requires opts.domainCount')
      const key = domainCount <= 5 ? 'domainCountAtOrBelow5' : 'domainCountAbove5'
      return { model: gate[mode][key].model }
    }
    const entry = gate[mode]
    if (!entry) throw new Error(`unknown gradingLevel mode: ${mode}`)
    return { model: entry.model, note: entry.note }
  }

  if (gateName === 'mapLevel') {
    const { mode } = opts
    if (!mode) throw new Error('mapLevel gate requires opts.mode')
    const entry = gate[mode]
    if (!entry) throw new Error(`unknown mapLevel mode: ${mode}`)
    return { model: entry.model, note: entry.note }
  }

  throw new Error(`unhandled gate: ${gateName}`)
}
