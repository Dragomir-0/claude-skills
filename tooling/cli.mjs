#!/usr/bin/env node
// tooling/cli.mjs — thin dispatcher so a skill's shell command can call one exported tooling
// function without writing an inline `-e` import script (and its `~`/quoting problems) per call.
// A skill running against an arbitrary target repo invokes this by its fixed install path, the
// same way map-codebase's map.mjs is invoked: `node ~/.claude/skills/tooling/cli.mjs <spec> <args>`.
//
// Usage: node cli.mjs <module>.<export> '[...jsonArgs]'
// Prints the JSON-stringified return value to stdout on success (exit 0). A thrown error from the
// underlying module is never swallowed — its message goes to stderr and the process exits 1, so a
// real bug in a tooling function surfaces as a failed command, not a silently wrong result.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Dynamic import() requires a file:// URL for an absolute path on Windows — a raw
// backslash-and-drive-letter path throws "Only URLs with a scheme ... are supported".
const libUrl = name => pathToFileURL(join(__dirname, 'lib', name)).href

const MODULES = {
  'complexity-scoring': () => import(libUrl('complexity-scoring.mjs')),
  'git-orchestration': () => import(libUrl('git-orchestration.mjs')),
  'commit-composer': () => import(libUrl('commit-composer.mjs')),
  changelog: () => import(libUrl('changelog.mjs')),
  'plan-pruning': () => import(libUrl('plan-pruning.mjs')),
  'cross-repo-table': () => import(libUrl('cross-repo-table.mjs'))
}

export function parseSpec (spec) {
  const dot = spec ? spec.indexOf('.') : -1
  if (dot === -1) return null
  return { moduleName: spec.slice(0, dot), fnName: spec.slice(dot + 1) }
}

export function parseArgs (argsJson) {
  if (argsJson === undefined) return []
  const parsed = JSON.parse(argsJson)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function main () {
  const [spec, argsJson] = process.argv.slice(2)
  const parsedSpec = parseSpec(spec)
  if (!parsedSpec) {
    console.error("usage: node cli.mjs <module>.<export> '[...jsonArgs]'")
    process.exitCode = 1
    return
  }
  const { moduleName, fnName } = parsedSpec
  const loader = MODULES[moduleName]
  if (!loader) {
    console.error(`unknown module: ${moduleName}. Known: ${Object.keys(MODULES).join(', ')}`)
    process.exitCode = 1
    return
  }

  const mod = await loader()
  const fn = mod[fnName]
  if (typeof fn !== 'function') {
    console.error(`unknown export: ${moduleName}.${fnName}`)
    process.exitCode = 1
    return
  }

  const args = parseArgs(argsJson)
  const result = fn(...args)
  console.log(JSON.stringify(result === undefined ? null : result))
}

// Only run when invoked directly (`node cli.mjs ...`), not when imported by the test file.
// Compared as file:// URLs, not raw strings — a raw `process.argv[1]` path never round-trips
// through backslashes and drive-letter casing on Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message)
    process.exitCode = 1
  })
}
