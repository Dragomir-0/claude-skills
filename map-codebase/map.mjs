#!/usr/bin/env node
// map.mjs — deterministic repository scanning for the map-codebase skill.
// Does every part of mapping that can be answered without a model, at zero token cost.
// No dependencies: node: builtins only. Runs on Node 16+.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Directories that are build output, dependency caches, or tool state. Anything gitignored is
// already excluded by listFiles(); this list is the fallback for trees git cannot answer for,
// and a second belt for repos that never ignored their own build output.
export const PRUNE = new Set([
  'node_modules', '.git', 'bin', 'obj', 'dist', 'build', '.vs', 'packages', 'coverage',
  // Added after a real scan walked 12 gitignored files out of 14: language and framework
  // caches no repo wants mapped, which discoverEdges would otherwise read in full.
  '.venv', 'venv', '.tox', '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', 'target', '.next', '.nuxt', '.svelte-kit', 'out', '.output',
  '.gradle', '.idea', '.dart_tool', '.terraform', '.angular', '.parcel-cache',
  'Pods', 'DerivedData', '.cache', '.turbo', 'TestResults'
])

/** Absolute path of the nearest ancestor containing .git, or null. */
export function findRepoRoot (startDir) {
  let dir = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Repo-relative, POSIX-separated paths of every file under root, minus the prune list. */
export function walk (root) {
  const out = []
  const rec = (abs, rel) => {
    let entries
    try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (PRUNE.has(e.name)) continue
        rec(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name)
      } else if (e.isFile()) {
        out.push(rel ? `${rel}/${e.name}` : e.name)
      }
    }
  }
  rec(path.resolve(root), '')
  return out.sort()
}

/**
 * A directory's canonical absolute path.
 *
 * On Windows a path may arrive in 8.3 short form (C:\Users\JASON_~1\...) while git and realpath
 * return the long form. Comparing or subtracting the two forms without canonicalising produces
 * "different directory" for the same directory, and a path.relative() full of `../..`.
 */
function realDir (p) {
  try { return fs.realpathSync.native(p) } catch { return path.resolve(p) }
}

function sameDir (a, b) {
  const x = realDir(a)
  const y = realDir(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

function git (root, args, maxBuffer = 64 * 1024 * 1024) {
  try {
    return execFileSync('git', args, {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer
    }).toString()
  } catch { return null }
}

/**
 * Tracked and untracked-but-not-ignored files, repo-relative and POSIX-separated.
 *
 * git is the authority on what belongs to a repo. A hardcoded prune list cannot know that this
 * particular repo keeps its dependencies in vendor/, its build in target/, or its virtualenv in
 * .venv/ — and walking those inflates fileCount, invents stacks (a vendored Go module adds "go"),
 * and makes discoverEdges read tens of thousands of files it should never open.
 *
 * Falls back to walk() when git cannot answer: a fixture with a fake .git, an empty repo, or git
 * missing from PATH.
 */
export function listFiles (root) {
  const top = git(root, ['rev-parse', '--show-toplevel'], 1 << 20)
  // Refuse a parent repo's answer: if root is not itself the repo root, git would list files
  // belonging to an enclosing repository.
  if (top && sameDir(top.trim(), root)) {
    const out = git(root, ['ls-files', '-co', '--exclude-standard', '--full-name', '-z'])
    if (out !== null) {
      const files = out.split('\0').filter(Boolean).map(f => f.replace(/\\/g, '/'))
        .filter(f => !f.split('/').some(seg => PRUNE.has(seg)))
        .sort()
      if (files.length) return files
    }
  }
  return walk(root)
}

const base = f => path.posix.basename(f)

const STACK_MARKERS = [
  ['dotnet', f => f.endsWith('.csproj') || f.endsWith('.sln') || f.endsWith('.fsproj')],
  ['flutter', f => base(f) === 'pubspec.yaml'],
  ['node', f => base(f) === 'package.json'],
  ['deno', f => ['deno.json', 'deno.jsonc'].includes(base(f))],
  ['python', f => ['pyproject.toml', 'pytest.ini', 'requirements.txt', 'setup.py',
                   'setup.cfg', 'Pipfile'].includes(base(f))],
  ['go', f => base(f) === 'go.mod'],
  ['rust', f => base(f) === 'Cargo.toml'],
  ['ruby', f => ['Gemfile', 'Rakefile'].includes(base(f)) || f.endsWith('.gemspec')],
  ['php', f => base(f) === 'composer.json'],
  ['cpp', f => ['CMakeLists.txt', 'meson.build'].includes(base(f)) || f.endsWith('.vcxproj')],
  ['swift', f => base(f) === 'Package.swift' || f.includes('.xcodeproj/')],
  ['elixir', f => base(f) === 'mix.exs'],
  // Android and JVM share Gradle. The manifest is what makes it Android; resolved below.
  ['android', f => base(f) === 'AndroidManifest.xml'],
  ['jvm', f => ['pom.xml', 'build.sbt', 'build.gradle', 'build.gradle.kts',
                'settings.gradle', 'settings.gradle.kts'].includes(base(f))]
]

// Infrastructure is reported separately from application stacks. Folding "docker" into stacks
// would make a .NET service claim two stacks and confuse downstream build-command inference;
// omitting it entirely made a pure-Terraform repo look unrecognised.
const INFRA_MARKERS = [
  ['docker', f => base(f) === 'Dockerfile' || /^Dockerfile\./.test(base(f)) ||
                  /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(base(f))],
  ['terraform', f => f.endsWith('.tf') || f.endsWith('.tfvars')],
  ['bicep', f => f.endsWith('.bicep')],
  ['kubernetes', f => base(f) === 'Chart.yaml' || /(^|\/)(k8s|kubernetes|helm|charts)\//i.test(f)]
]

export const UNKNOWN_STACK_HINT =
  'Unrecognised stack: no known build manifest was found. Say so in the map rather than ' +
  'guessing — name the file extensions actually present, and ask the user for the build and ' +
  'test commands instead of inferring them.'

const ENTRY_NAMES = new Set([
  'Program.cs', 'Startup.cs', 'Program.fs', 'main.dart', 'main.rs', 'manage.py', 'wsgi.py',
  'asgi.py', '__main__.py', 'config.ru', 'artisan', 'main.swift', 'main.cpp', 'main.go'
])
const ENTRY_STEMS = new Set(['index', 'server', 'main', 'app'])
// .tsx/.jsx were missing, so every React and modern-Angular frontend reported no entry point at
// all — in a skill whose workspace story is frontend-to-backend.
const ENTRY_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.php', '.rb', '.rs'
])
// Frameworks that name their entry class rather than their file.
const ENTRY_PATTERNS = [/Application\.(java|kt|scala)$/, /(^|\/)Main\.(java|kt|scala)$/]

/** Sorted unique stack names present in the file list. */
export function detectStacks (files) {
  const hit = new Set()
  for (const f of files) {
    for (const [name, match] of STACK_MARKERS) if (match(f)) hit.add(name)
  }
  // Gradle is used by both Android and plain JVM projects. An AndroidManifest.xml is what
  // distinguishes them; without it, a Gradle build is a JVM build. Reporting a Spring Boot
  // service as "android" is worse than reporting nothing.
  if (hit.has('android')) hit.delete('jvm')
  return [...hit].sort()
}

/** Sorted unique infrastructure technologies present in the file list. */
export function detectInfra (files) {
  const hit = new Set()
  for (const f of files) {
    for (const [name, match] of INFRA_MARKERS) if (match(f)) hit.add(name)
  }
  return [...hit].sort()
}

/**
 * Files that look like application entry points, shallowest first.
 *
 * When `root` is supplied, package.json's declared `main` (and `scripts.start` target) wins over
 * filename guessing — Node services routinely name their entry `app.js`, which no heuristic
 * would rank above any other file.
 *
 * Depth ordering matters because callers cap the list: src/main.tsx is a likelier entry than
 * src/features/orders/components/index.ts, and alphabetical order cannot tell them apart.
 */
export function findEntryPoints (files, root) {
  const out = new Set()

  if (root) {
    const present = new Set(files)
    for (const f of files) {
      if (path.posix.basename(f) !== 'package.json') continue
      let pkg
      try { pkg = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')) } catch { continue }
      const dir = path.posix.dirname(f)
      const declared = [pkg.main, extractStartTarget(pkg.scripts?.start)]
      for (const d of declared) {
        if (!d) continue
        const rel = (dir === '.' ? d : `${dir}/${d}`).replace(/^\.\//, '')
        if (present.has(rel)) out.add(rel)
      }
    }
  }

  for (const f of files) {
    const name = path.posix.basename(f)
    if (ENTRY_NAMES.has(name)) { out.add(f); continue }
    if (ENTRY_PATTERNS.some(re => re.test(f))) { out.add(f); continue }
    const ext = path.posix.extname(name)
    // Case-insensitive stem: App.tsx, Index.js and Main.ts are entry points too.
    if (ENTRY_EXTS.has(ext) && ENTRY_STEMS.has(name.slice(0, -ext.length).toLowerCase())) out.add(f)
  }

  return [...out].sort((a, b) =>
    a.split('/').length - b.split('/').length || a.localeCompare(b))
}

/** Pull a script path out of an npm start command, e.g. "node app.js --port 3000" -> "app.js". */
function extractStartTarget (start) {
  if (typeof start !== 'string') return null
  const m = start.match(/(?:^|\s)([\w./-]+\.(?:js|mjs|cjs|ts))(?:\s|$)/)
  return m ? m[1] : null
}

// Docs a repo writes about itself. The first group is addressed to coding agents and is
// authoritative where it disagrees with anything inferred from file structure.
const AGENT_DOCS = ['claude.md', 'agents.md', 'gemini.md', 'onboarding.md']
const HUMAN_DOCS = ['readme.md', 'architecture.md', 'contributing.md', 'development.md', 'setup.md']
const MAX_DOC_DEPTH = 3

/**
 * Project documentation, agent-directed files first.
 *
 * A repo that documents itself is the authority on its own architecture — reading these before
 * inferring anything from directory names avoids confidently-wrong maps.
 */
export function findProjectDocs (files) {
  const rank = f => {
    const b = path.posix.basename(f).toLowerCase()
    const depth = f.split('/').length
    if (depth > MAX_DOC_DEPTH) return null
    if (AGENT_DOCS.includes(b)) return 0
    if (HUMAN_DOCS.includes(b)) return 1
    if (/^docs?\//i.test(f) && b.endsWith('.md')) return 2
    return null
  }
  return files
    .map(f => ({ f, r: rank(f) }))
    .filter(x => x.r !== null)
    .sort((a, b) => a.r - b.r || a.f.split('/').length - b.f.split('/').length ||
                    a.f.localeCompare(b.f))
    .map(x => x.f)
}

/** Split the file list into test files and CI/pipeline definitions. */
export function findTestAndCi (files) {
  const tests = files.filter(f =>
    /(^|\/)(tests?|spec)\//i.test(f) || /\.(tests?|spec)\.[a-z]+$/i.test(f) ||
    /(Tests?|Spec)\.csproj$/.test(f) || /_test\.(dart|go|py|exs?)$/.test(f) ||
    // xUnit and JUnit name the class, not the directory: OrderServiceTests.cs, FooTest.java.
    /(^|\/)[A-Z][\w]*Tests?\.(cs|java|kt|scala|fs)$/.test(f) ||
    // pytest's other convention, and RSpec.
    /(^|\/)test_[^/]+\.py$/.test(f) || /_spec\.rb$/.test(f)
  ).sort()
  const ci = files.filter(f =>
    /(^|\/)azure-pipelines[^/]*\.ya?ml$/i.test(f) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(f) ||
    /(^|\/)\.gitlab-ci\.ya?ml$/i.test(f) ||
    /(^|\/)Jenkinsfile[^/]*$/.test(f) ||
    /(^|\/)\.circleci\/config\.ya?ml$/i.test(f) ||
    /(^|\/)bitbucket-pipelines\.ya?ml$/i.test(f) ||
    /(^|\/)\.(travis|drone|appveyor)\.ya?ml$/i.test(f) ||
    /(^|\/)appveyor\.ya?ml$/i.test(f)
  ).sort()
  return { tests, ci }
}

/**
 * Directory shape: the top levels of the tree with file counts and dominant extensions.
 *
 * Without this the model has no structural data at all — it is told not to re-walk the tree, then
 * asked to carve the repo into domains. This is the deterministic half of that judgement.
 */
export function buildTree (files, { depth = 2, limit = 40 } = {}) {
  const dirs = new Map()
  for (const f of files) {
    const parts = f.split('/')
    const key = parts.length === 1
      ? '.'
      : parts.slice(0, Math.min(depth, parts.length - 1)).join('/')
    if (!dirs.has(key)) dirs.set(key, { dir: key, files: 0, ext: new Map() })
    const e = dirs.get(key)
    e.files++
    const x = path.posix.extname(f).toLowerCase() || '(none)'
    e.ext.set(x, (e.ext.get(x) ?? 0) + 1)
  }
  const all = [...dirs.values()]
    .sort((a, b) => b.files - a.files || a.dir.localeCompare(b.dir))
    .map(e => ({
      dir: e.dir,
      files: e.files,
      exts: [...e.ext.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + ' ' + v)
    }))
  return limit && all.length > limit
    ? { dirs: all.slice(0, limit), omitted: all.length - limit }
    : { dirs: all, omitted: 0 }
}

// ------------------------------------------------------------------- citations

// A scheme prefix ("https:") or a Windows drive letter ("C:") means the token is not a
// repo-relative path. Left unfiltered, a URL in a map resolved to nothing and reported permanent
// drift — which gates cleanup-crew's commits until someone finds it by hand.
const NOT_A_REPO_PATH = /^[A-Za-z][A-Za-z0-9+.-]*:/

/**
 * Repo-relative paths cited in backticks in a map file.
 *
 * A token counts only if it contains a slash, has a file extension, is glob-free, and is neither
 * a URL nor an absolute path — which excludes prose, globs, and bare command names, keeping
 * --verify free of false positives. cleanup-crew gates on this exit code, so precision beats
 * recall here.
 *
 * Tokens containing spaces are returned only under `withSpaces`: a real path may contain a space
 * (src/My Project/Program.cs), but so does every shell command, and no rule separates them
 * reliably. verifyMaps reports those separately and never fails the build on one.
 */
export function citedPaths (mapText, { withSpaces = false } = {}) {
  const out = new Set()
  for (const m of mapText.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim()
    if (!t.includes('/')) continue
    // Globs and placeholders describe a shape, not a file: src/**/*.cs, services/<area>.ts,
    // api/{id}/thing.ts. None of them can be resolved, so none of them are citations.
    if (/[*<>{}]/.test(t)) continue
    if (t.includes(' ') !== withSpaces) continue
    // Shell metacharacters and flag arguments mean this is a command, not a path.
    if (/[|;&$"']/.test(t) || /(^|\s)-{1,2}\w/.test(t)) continue
    // Parent-relative paths cannot be resolved against a repo root — a map that needs to point
    // outside its own repo should name the other repo explicitly instead.
    if (t.startsWith('../') || t.includes('/../')) continue
    if (t.startsWith('/') || NOT_A_REPO_PATH.test(t)) continue
    if (!/\.[A-Za-z0-9]+$/.test(t)) continue
    out.add(t.replace(/^\.\//, ''))
  }
  return [...out].sort()
}

// ---------------------------------------------------------- read-only guardrail

const SHELL_LANGS = new Set([
  'sh', 'bash', 'zsh', 'shell', 'console', 'powershell', 'pwsh', 'ps1', 'cmd', 'bat', 'batch',
  'dos', 'terminal'
])

const SECRET_PATTERNS = [
  [/\b(?:sk|rk)-[A-Za-z0-9]{16,}\b/, 'api key'],
  [/\bghp_[A-Za-z0-9]{20,}\b/, 'github token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'aws access key id'],
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, 'jwt'],
  [/(?:Server|Data Source|Host)\s*=[^\n]{0,120}?(?:Password|Pwd)\s*=/i, 'connection string'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s`/@:]+:[^\s`/@]+@/i, 'secret embedded in a url']
]

// The one region of a map allowed to carry commands. See the read-only guardrail in
// pipeline-contract.md: build and test commands are recorded as DATA for downstream stages
// (/test-feature needs the command, and guessing it is worse than recording it), never as an
// instruction the reading run should execute.
const COMMANDS_SECTION = /^##+\s*Build (?:&|and) test commands\s*$/i

/**
 * Read-only guardrail violations in a map: shell blocks and secret-shaped strings.
 *
 * Returns [{ line, kind, detail }]. Purely deterministic. The model was the only enforcement
 * before this, and a model cannot enforce a rule against a map it has not read.
 */
export function lintMapText (text) {
  const hits = []
  const lines = text.split('\n')
  let fence = null
  let exempt = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/)
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1][0]
        const lang = fenceMatch[2].toLowerCase()
        if (!exempt && SHELL_LANGS.has(lang)) {
          hits.push({ line: i + 1, kind: 'command', detail: lang + ' code block' })
        }
      } else if (line.trim().startsWith(fence)) {
        fence = null
      }
      continue
    }
    if (fence === null && /^##+\s/.test(line)) exempt = COMMANDS_SECTION.test(line)
    if (exempt) continue
    for (const [re, kind] of SECRET_PATTERNS) {
      if (re.test(line)) { hits.push({ line: i + 1, kind: 'secret', detail: kind }); break }
    }
  }
  return hits
}

// -------------------------------------------------------------------- map state

/** The `Generated:` header of a map — its date and, when present, the commit it described. */
export function mapHeader (text) {
  const head = text.split('\n').slice(0, 30).join('\n')
  const m = head.match(
    /^[\s>*-]*(?:\*\*)?Generated:?(?:\*\*)?[:\s]*(\d{4}-\d{2}-\d{2}(?:[T ][\d:.Z+-]+)?)\s*(?:\(([0-9a-fA-F]{7,40})\))?/im
  )
  if (!m) return { generated: null, sha: null }
  return { generated: m[1], sha: m[2] ? m[2].toLowerCase() : null }
}

function ageInDays (iso, now) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now - t) / 86400000)
}

/** Every map file under .claude/maps, with its citations, ownership prefixes and header. */
export function mapOwnership (root) {
  const mapsDir = path.join(root, '.claude', 'maps')
  if (!fs.existsSync(mapsDir)) return []
  return walk(mapsDir).filter(f => f.endsWith('.md')).map(rel => {
    let text = ''
    try { text = fs.readFileSync(path.join(mapsDir, rel), 'utf8') } catch { /* unreadable */ }
    const cited = citedPaths(text)
    // A map citing src/Orders/Foo.cs owns src/Orders/ — otherwise a NEW file in an already-mapped
    // domain belongs to no map, and --update silently skips the domain it changed.
    const prefixes = [...new Set(cited.map(c => {
      const d = path.posix.dirname(c)
      return d === '.' ? '' : d + '/'
    }))].filter(Boolean).sort((a, b) => b.length - a.length)
    return {
      map: '.claude/maps/' + rel.replace(/\\/g, '/'),
      cited,
      prefixes,
      text,
      ...mapHeader(text)
    }
  })
}

/** Assign changed files to the map that owns them: exact citation first, then longest prefix. */
export function assignChanges (owners, changed) {
  const byMap = new Map(owners.map(o => [o.map, []]))
  const unowned = []
  for (const f of changed) {
    let hit = owners.find(o => o.cited.includes(f))
    if (!hit) {
      let best = null
      for (const o of owners) {
        for (const p of o.prefixes) {
          if (f.startsWith(p) && (!best || p.length > best.len)) best = { o, len: p.length }
        }
      }
      hit = best?.o
    }
    if (hit) byMap.get(hit.map).push(f)
    else unowned.push(f)
  }
  return { byMap, unowned }
}

/**
 * Resolve every path cited by every map; any that no longer resolves is drift.
 *
 * Three failure modes this catches that a plain existsSync did not:
 *  - case drift — src/program.cs for src/Program.cs passes existsSync on Windows and macOS, then
 *    breaks every Linux consumer of the map;
 *  - a map with no citations at all, which passed trivially while documenting nothing;
 *  - commands and secrets in a map, which the guardrail forbade and nothing detected.
 */
export function verifyMaps (root, { maxAgeDays = 14, now = Date.now() } = {}) {
  const drift = []
  const unverified = []
  const guardrail = []
  const maps = []
  const mapsDir = path.join(root, '.claude', 'maps')
  if (!fs.existsSync(mapsDir)) {
    return { ok: true, drift, unverified, guardrail, maps, emptyMaps: [], staleMaps: [] }
  }

  // Canonicalised, so path.relative() below subtracts like-for-like on Windows short paths.
  const realRoot = realDir(root)
  // Indexed by lowercase name, and used ONLY to give a wrong-case citation a better message on a
  // case-sensitive filesystem. It is never used to decide that a path exists: git ls-files reads
  // the index, so a file deleted from the working tree is still listed, and trusting it would let
  // the commonest drift of all — someone deleted the file — pass as clean.
  // Built lazily: a clean run never needs it, and listFiles() is a full git ls-files.
  let byLower = null
  const lowerIndex = () => {
    if (!byLower) {
      byLower = new Map()
      for (const f of listFiles(root)) byLower.set(f.toLowerCase(), f)
    }
    return byLower
  }

  const resolve = cited => {
    const abs = path.join(root, cited)
    if (!fs.existsSync(abs)) {
      const match = lowerIndex().get(cited.toLowerCase())
      if (match && match !== cited) return { ok: false, reason: 'case mismatch', actual: match }
      return { ok: false, reason: 'missing' }
    }
    // On a case-insensitive filesystem existsSync says yes to the wrong case, so ask the OS what
    // the file is really called. Only a pure case difference is drift — a symlink resolving
    // elsewhere is not.
    let real = null
    try { real = fs.realpathSync.native(abs) } catch { /* fall through */ }
    if (real) {
      const rel = path.relative(realRoot, real).split(path.sep).join('/')
      if (rel && rel !== cited && rel.toLowerCase() === cited.toLowerCase()) {
        return { ok: false, reason: 'case mismatch', actual: rel }
      }
    }
    return { ok: true }
  }

  for (const o of mapOwnership(root)) {
    let missing = 0
    for (const cited of o.cited) {
      const r = resolve(cited)
      if (!r.ok) {
        const entry = { map: o.map, missing: cited, reason: r.reason }
        if (r.actual) entry.actual = r.actual
        drift.push(entry)
        missing++
      }
    }
    for (const spaced of citedPaths(o.text, { withSpaces: true })) {
      if (!resolve(spaced).ok) {
        unverified.push({ map: o.map, path: spaced })
      }
    }
    for (const hit of lintMapText(o.text)) guardrail.push({ map: o.map, ...hit })
    const age = o.generated ? ageInDays(o.generated, now) : null
    maps.push({
      map: o.map,
      cited: o.cited.length,
      missing,
      generated: o.generated,
      sha: o.sha,
      ageDays: age,
      stale: age === null || age > maxAgeDays
    })
  }

  return {
    ok: drift.length === 0 && guardrail.length === 0,
    drift,
    unverified,
    ...(unverified.length && { unverifiedNote: 'paths contain a space; not treated as drift' }),
    guardrail,
    maps,
    emptyMaps: maps.filter(m => m.cited === 0 && !m.map.endsWith('/index.md')).map(m => m.map),
    staleMaps: maps.filter(m => m.stale).map(m => m.map)
  }
}

/**
 * Files changed vs a baseline: unstaged, staged, and untracked-but-not-ignored.
 *
 * `since` is the commit a map was generated against. Without it the comparison is against HEAD,
 * which meant /map-codebase --update did nothing at all once the work was committed — the single
 * commonest moment to refresh a map.
 *
 * Returns [] when git is unavailable or the directory is not a repo.
 */
export function changedFiles (root, since) {
  const run = args => {
    const out = git(root, args)
    return out === null ? null : out.split('\n').map(s => s.trim()).filter(Boolean)
  }
  const usable = Boolean(since) && git(root, ['cat-file', '-e', since + '^{commit}'], 65536) !== null
  const parts = usable
    ? [run(['diff', '--name-only', since]), run(['ls-files', '--others', '--exclude-standard'])]
    : [
        run(['diff', '--name-only', 'HEAD']),
        run(['diff', '--name-only', '--staged']),
        run(['ls-files', '--others', '--exclude-standard'])
      ]
  if (parts.every(p => p === null)) return []
  return [...new Set(parts.filter(Boolean).flat())].sort()
}

// --------------------------------------------------------------------- ignores

export const GITIGNORE_ENTRIES = ['.claude/maps/', '.claude/plans/', '.claude/reports/']

/** Which pipeline artifact directories the repo's .gitignore does not yet cover. */
export function gitignoreStatus (root) {
  const p = path.join(root, '.gitignore')
  const exists = fs.existsSync(p)
  let lines = []
  if (exists) {
    lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.replace(/^\//, '').replace(/\/+$/, ''))
  }
  const covers = e => {
    const t = e.replace(/\/+$/, '')
    return lines.some(l => l === t || l === '.claude' || l === t + '/**' || l === t + '/*')
  }
  return { path: '.gitignore', exists, missing: GITIGNORE_ENTRIES.filter(e => !covers(e)) }
}

/**
 * Append the missing artifact directories, creating .gitignore if absent.
 *
 * Appends only — never rewrites, never reorders, and preserves the file's existing line endings.
 * This is the one mutation the skill performs, so it stays narrow and auditable.
 */
export function ensureGitignore (root) {
  const st = gitignoreStatus(root)
  if (st.missing.length === 0) return { ...st, written: false }
  const p = path.join(root, '.gitignore')
  const prev = st.exists ? fs.readFileSync(p, 'utf8') : ''
  const eol = /\r\n/.test(prev) ? '\r\n' : '\n'
  const lead = prev === '' ? '' : (prev.endsWith('\n') ? eol : eol + eol)
  fs.appendFileSync(
    p,
    lead + '# Claude Code pipeline artifacts' + eol + st.missing.map(e => e + eol).join('')
  )
  return { ...st, written: true }
}

// ------------------------------------------------------------------- workspace

export const WORKSPACE_CONFIG = '.claude-workspace.json'

/** Names of immediate subdirectories that are git repos, sorted. */
export function childRepos (dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter(e => e.isDirectory() && !PRUNE.has(e.name))
    .filter(e => fs.existsSync(path.join(dir, e.name, '.git')))
    .map(e => e.name)
    .sort()
}

function readWorkspaceConfig (dir) {
  const p = path.join(dir, WORKSPACE_CONFIG)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

/**
 * True when dir holds at least one subdirectory that is itself a container of 2+ repos.
 * Such a directory is a *collection* of workspaces, not a workspace: e.g. a Projects folder
 * holding several products plus a couple of loose clones. Pairing those loose clones as one
 * system would be wrong.
 */
function holdsSubWorkspaces (dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  return entries.some(e =>
    e.isDirectory() && !PRUNE.has(e.name) &&
    !fs.existsSync(path.join(dir, e.name, '.git')) &&
    childRepos(path.join(dir, e.name)).length >= 2)
}

function buildWorkspace (dir) {
  const config = readWorkspaceConfig(dir)
  const exclude = new Set(config?.exclude ?? [])
  const names = childRepos(dir).filter(n => !exclude.has(n))
  if (names.length < 2) return null
  // An explicit config is an override: the user has declared this set deliberately.
  if (!config && holdsSubWorkspaces(dir)) return null
  return {
    root: path.resolve(dir),
    name: config?.name ?? path.basename(path.resolve(dir)),
    config,
    repos: names.map(name => ({
      name,
      path: path.join(dir, name),
      role: config?.repos?.[name]?.role
    }))
  }
}

/**
 * The workspace containing startDir, or null.
 * A workspace is a directory holding 2+ git repos. A lone repo with no sibling repos is not a
 * workspace — single-repo behaviour is unchanged, which is the whole point.
 */
export function findWorkspace (startDir) {
  const dir = path.resolve(startDir)

  // 1. startDir is itself the container.
  const here = buildWorkspace(dir)
  if (here) return here

  // 2. startDir is inside a repo — the container can only be that repo's parent.
  //
  // Deliberately bounded to exactly one level. An unbounded walk keeps climbing until it finds
  // any directory with 2+ repos, which will eventually be a home or temp directory full of
  // unrelated checkouts. That is not a workspace, and treating it as one would map unrelated
  // systems together.
  const repo = findRepoRoot(dir)
  if (repo) {
    const parent = path.dirname(repo)
    if (parent !== repo) return buildWorkspace(parent)
  }

  return null
}

// -------------------------------------------------------------- edge discovery

// php and ruby were declared stacks whose source was never scanned for edges; template-first
// frameworks keep their HTTP calls in .vue/.svelte/.razor/.cshtml files.
const SOURCE_EXTS = new Set([
  '.cs', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.java', '.kt', '.dart', '.py', '.go',
  '.php', '.rb', '.rs', '.scala', '.swift', '.vue', '.svelte', '.razor', '.cshtml'
])
const MAX_SOURCE_BYTES = 512 * 1024
// A frontend/backend pair yields ~100 route edges. At 20 sites each that is 2,000 records handed
// to the model *before* it is told to summarise — the opposite of this script's purpose.
const DEFAULT_MAX_SITES = 3

// Each matcher yields the identifier two repos would have in common. Values are never captured
// from configuration files — the global ignore list bars reading them — so an HTTP target is
// recorded as its config KEY and the value stays unread.
const EDGE_MATCHERS = [
  { kind: 'queue', re: /\b(?:Queue|Topic|Subscription)Name\b\s*[:=]\s*["'`]([\w.\-/]+)["'`]/g },
  { kind: 'queue', re: /\b(?:CreateQueue|GetQueue|SendMessage|ReceiveMessage)\w*\s*\(\s*["'`]([\w.\-/]+)["'`]/g },
  { kind: 'socket', re: /\b(?:socket|io|hub|connection)\s*\.\s*(?:on|emit|to|invoke|send)\s*\(\s*["'`]([\w.\-]+)["'`]/gi },
  { kind: 'httpConfigKey', re: /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:URL|URI|ENDPOINT|BASEURL|HOST))\b/g },
  // Server-side route declarations and client-side call paths reduce to the same segments,
  // so a route declared in one repo and called from another matches on the segment name.
  // This is the commonest cross-repo coupling of all (frontend to backend) and was invisible
  // until it was added.
  { kind: 'httpRoute', re: /\[(?:Http(?:Get|Post|Put|Delete|Patch)|Route)\("([^"]+)"\)\]/g, segments: true },
  // Anywhere in a string, not anchored to its start: client code routinely interpolates a base
  // URL first, e.g. `${environment.api}/api/v1/Thing/Action`.
  { kind: 'httpRoute', re: /(\/(?:api|API)\/[\w{}$.\-/]{2,120})/g, segments: true },
  { kind: 'httpRoute', re: /["'`](\/?[A-Za-z][\w-]{3,}(?:\/[\w{}$-]+){1,6})["'`]/g, segments: true }
]

// Path pieces that carry no contract meaning — matching on these would pair every repo with
// every other repo that happens to serve HTTP.
const GENERIC_SEGMENTS = new Set([
  'api', 'v1', 'v2', 'v3', 'v1.0', 'v2.0', 'get', 'post', 'put', 'delete', 'patch', 'id',
  'index', 'list', 'all', 'new', 'edit', 'create', 'update', 'remove', 'http', 'https',
  'localhost', 'assets', 'static', 'public', 'src', 'app', 'com', 'net', 'org', 'www',
  // MIME types split on '/' exactly like routes do, so "application/json" and
  // "application/x-www-form-urlencoded" would otherwise pair every repo that sets a header.
  'application', 'json', 'text', 'xml', 'html', 'plain', 'octet-stream', 'form-data',
  'x-www-form-urlencoded', 'multipart', 'image', 'audio', 'video', 'pdf', 'csv', 'zip'
])

/** Split a route or path into the segments that could be a shared contract name. */
function routeSegments (raw) {
  return raw.split('/')
    .map(s => s.trim())
    .filter(s => s.length >= 4)
    .filter(s => !s.includes('{') && !s.includes('}') && !s.includes(':') && !s.includes('$'))
    .filter(s => !GENERIC_SEGMENTS.has(s.toLowerCase()))
    .filter(s => /^[A-Za-z][\w-]*$/.test(s))
}

/**
 * Cross-repo integration candidates, found deterministically over pruned source only.
 *
 * Returns { edges, internal }: `edges` are identifiers seen in 2+ repos (a real cross-repo
 * coupling); `internal` are seen in exactly one. These are CANDIDATES for a model to confirm
 * and describe — the script asserts only that the same string appears in both places.
 */
export function discoverEdges (repos, { maxSites = DEFAULT_MAX_SITES } = {}) {
  const seen = new Map()

  for (const repo of repos) {
    if (!fs.existsSync(repo.path)) continue
    // listFiles() honours .gitignore and PRUNE, so node_modules / vendor / .venv / target never
    // reach the matchers.
    for (const rel of listFiles(repo.path)) {
      if (!SOURCE_EXTS.has(path.posix.extname(rel))) continue
      const abs = path.join(repo.path, rel)
      let text
      try {
        if (fs.statSync(abs).size > MAX_SOURCE_BYTES) continue
        text = fs.readFileSync(abs, 'utf8')
      } catch { continue }

      // Newline offsets, built on first need: re-splitting the file prefix per match was
      // quadratic in file size for route-heavy files.
      let nl = null
      const lineAt = idx => {
        if (!nl) {
          nl = []
          for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) nl.push(i)
        }
        let lo = 0
        let hi = nl.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (nl[mid] < idx) lo = mid + 1
          else hi = mid
        }
        return lo + 1
      }

      for (const { kind, re, segments } of EDGE_MATCHERS) {
        for (const m of text.matchAll(re)) {
          if (!m[1]) continue
          const names = segments ? routeSegments(m[1]) : [m[1]]
          for (const name of names) {
            if (name.length < 3) continue
            const key = kind + ' ' + name
            if (!seen.has(key)) {
              seen.set(key, { kind, name, repos: new Set(), sites: [], siteCount: 0 })
            }
            const entry = seen.get(key)
            entry.repos.add(repo.name)
            entry.siteCount++
            if (entry.sites.length < maxSites) {
              entry.sites.push({
                repo: repo.name,
                file: rel,
                line: lineAt(m.index)
              })
            }
          }
        }
      }
    }
  }

  const all = [...seen.values()]
    .map(e => ({
      kind: e.kind,
      name: e.name,
      repos: [...e.repos].sort(),
      sites: e.sites,
      siteCount: e.siteCount
    }))
    .sort((a, b) => b.repos.length - a.repos.length || a.name.localeCompare(b.name))

  return {
    edges: all.filter(e => e.repos.length >= 2),
    internal: all.filter(e => e.repos.length === 1)
  }
}

// ------------------------------------------------------------------------- cli

const VALUE_FLAGS = {
  '--root': 'root', '--max-age': 'maxAge', '--sites': 'sites', '--limit': 'limit'
}
const NUMERIC_FLAGS = new Set(['maxAge', 'sites', 'limit'])
const BOOL_FLAGS = { '--full': 'full', '--workspace': 'workspace', '--write': 'write' }

export function parseArgs (argv) {
  const flags = {
    root: null, full: false, workspace: false, write: false,
    maxAge: 14, sites: DEFAULT_MAX_SITES, limit: 0
  }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a in VALUE_FLAGS) {
      const v = argv[i + 1]
      // `--root` with no value used to crash with a raw ERR_INVALID_ARG_TYPE stack trace.
      if (v === undefined || v.startsWith('--')) return { error: a + ' requires a value' }
      i++
      const key = VALUE_FLAGS[a]
      if (NUMERIC_FLAGS.has(key)) {
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) return { error: a + ' requires a non-negative number' }
        flags[key] = n
      } else flags[key] = v
    } else if (a in BOOL_FLAGS) flags[BOOL_FLAGS[a]] = true
    else if (a.startsWith('-')) return { error: 'unknown flag ' + a }
    else rest.push(a)
  }
  return { flags, rest }
}

const USAGE =
  'usage: map.mjs <scan|update|verify|gitignore|workspace|edges> [--root <dir>] [options]\n' +
  '  scan [--full]                  inventory one repo (lists capped unless --full)\n' +
  '  update [--full]                files changed since each map was generated, by owning map\n' +
  '  verify [--max-age <days>]      drift, case drift, empty maps, guardrail violations\n' +
  '  gitignore [--write]            report or add the pipeline artifact ignore entries\n' +
  '  workspace                      repo inventory for a container of 2+ repos\n' +
  '  edges [--sites n] [--limit n]  cross-repo integration candidates\n' +
  '  verify --workspace             drift across every repo in the workspace\n'

const DOC_CAP = 12
const ENTRY_CAP = 15
const TEST_CAP = 15
const CI_CAP = 20
const CHANGE_CAP = 200

// Compact, not indented: this output is read by a model, and indentation is pure token cost.
function say (obj) { process.stdout.write(JSON.stringify(obj) + '\n') }

/** Whether maps already exist, and how many search hints the ledger holds. */
function mapsState (root) {
  const mapsDir = path.join(root, '.claude', 'maps')
  if (!fs.existsSync(mapsDir)) {
    return { exist: false, note: 'No maps yet - this is a full build.' }
  }
  const files = walk(mapsDir).filter(f => f.endsWith('.md'))
  const indexPath = path.join(mapsDir, 'index.md')
  let searchHints = 0
  if (fs.existsSync(indexPath)) {
    const t = fs.readFileSync(indexPath, 'utf8')
    const after = t.split(/^##\s+Search hints\s*$/im)[1]
    if (after) {
      searchHints = after.split(/^##\s/m)[0].split('\n').filter(l => l.includes('->')).length
    }
  }
  const state = {
    exist: true,
    count: files.length,
    files: files.map(f => '.claude/maps/' + f),
    searchHints
  }
  if (searchHints > 0) {
    state.readFirst = '.claude/maps/index.md carries ' + searchHints + ' search hints. Read them ' +
      'before searching the filesystem - the ledger exists to make this run cheaper than the last.'
  }
  return state
}

function scanCmd (root, flags) {
  const files = listFiles(root)
  const { tests, ci } = findTestAndCi(files)
  const stacks = detectStacks(files)
  const infra = detectInfra(files)
  const docs = findProjectDocs(files)
  const entries = findEntryPoints(files, root)
  const cap = (arr, n) => (flags.full ? arr : arr.slice(0, n))
  const out = {
    root,
    fileCount: files.length,
    stacks,
    infra,
    // Listed before everything else: read these before inferring anything.
    projectDocs: cap(docs, DOC_CAP),
    projectDocsTotal: docs.length,
    tree: buildTree(files),
    entryPoints: cap(entries, ENTRY_CAP),
    entryPointsTotal: entries.length,
    tests: cap(tests, TEST_CAP),
    testsTotal: tests.length,
    ci: cap(ci, CI_CAP),
    ciTotal: ci.length,
    gitignore: gitignoreStatus(root),
    maps: mapsState(root)
  }
  if (stacks.length === 0 && infra.length === 0) out.stackHint = UNKNOWN_STACK_HINT
  const truncated = docs.length > out.projectDocs.length ||
    entries.length > out.entryPoints.length ||
    tests.length > out.tests.length ||
    ci.length > out.ci.length ||
    out.tree.omitted > 0
  if (truncated) {
    out.truncated =
      'Lists are capped so this payload stays small. Re-run with --full for complete lists.'
  }
  say(out)
  return 0
}

function updateCmd (root, flags) {
  const owners = mapOwnership(root)
  const head = git(root, ['rev-parse', 'HEAD'], 65536)
  // Maps generated together share a baseline; diff each distinct one once.
  const bySha = new Map()
  const diff = sha => {
    if (!bySha.has(sha)) bySha.set(sha, changedFiles(root, sha))
    return bySha.get(sha)
  }
  const union = [...new Set([...diff(null), ...owners.flatMap(o => diff(o.sha))])].sort()
  const { byMap, unowned } = assignChanges(owners, union)
  const cap = arr => (flags.full ? arr : arr.slice(0, CHANGE_CAP))
  const now = Date.now()
  const out = {
    root,
    headSha: head ? head.trim().slice(0, 12) : null,
    // The union itself is not listed: it is exactly maps[].changed plus unowned.
    changedTotal: union.length,
    maps: owners.map(o => {
      const mine = byMap.get(o.map) ?? []
      const row = {
        map: o.map,
        baseline: o.sha,
        generated: o.generated,
        ageDays: o.generated ? ageInDays(o.generated, now) : null,
        regenerate: mine.length > 0
      }
      if (mine.length) Object.assign(row, { changed: cap(mine), changedTotal: mine.length })
      return row
    }),
    unowned: cap(unowned),
    unownedTotal: unowned.length
  }
  if (owners.length === 0) {
    out.hint = 'No maps exist yet - run a full build rather than an update.'
  } else if (owners.every(o => !o.sha)) {
    out.hint = 'No map records a commit in its Generated: header, so the baseline is HEAD and ' +
      'committed work is invisible. Write "Generated: <ISO date> (<short sha>)" on every map.'
  } else if (unowned.length) {
    out.hint = unowned.length + ' changed file(s) belong to no map - a new domain, or a domain ' +
      'whose map cites nothing near them. Decide whether they need a new map.'
  }
  say(out)
  return 0
}

function workspaceCmd (ws) {
  say({
    root: ws.root,
    name: ws.name,
    configured: Boolean(ws.config),
    repos: ws.repos.map(r => {
      const files = listFiles(r.path)
      const { tests, ci } = findTestAndCi(files)
      return {
        name: r.name,
        role: r.role,
        fileCount: files.length,
        stacks: detectStacks(files),
        infra: detectInfra(files),
        projectDocs: findProjectDocs(files).slice(0, 5),
        entryPoints: findEntryPoints(files, r.path).slice(0, 5),
        hasTests: tests.length > 0,
        hasCi: ci.length > 0
      }
    })
  })
  return 0
}

function edgesCmd (ws, flags) {
  const { edges, internal } = discoverEdges(ws.repos, { maxSites: flags.sites })
  const shown = flags.limit ? edges.slice(0, flags.limit) : edges
  const out = {
    root: ws.root,
    name: ws.name,
    edgeCount: edges.length,
    // Sites as "repo:file:line" strings: repeating the object keys tripled each site's size.
    edges: shown.map(e => ({ ...e, sites: e.sites.map(s => s.repo + ':' + s.file + ':' + s.line) })),
    internalCount: internal.length
  }
  if (shown.length < edges.length) out.omitted = edges.length - shown.length
  out.hint = 'Candidates only: the script asserts that the same string appears in two repos and ' +
    'nothing more. Confirm each before writing it into a map, and group them by controller or ' +
    'domain rather than listing every row.'
  say(out)
  return 0
}

function cli (argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    process.stderr.write('map.mjs: ' + parsed.error + '\n\n' + USAGE)
    return 2
  }
  const { flags, rest } = parsed
  const cmd = rest[0]
  const start = flags.root ?? process.cwd()

  if (flags.root !== null && !fs.existsSync(flags.root)) {
    process.stderr.write('map.mjs: --root does not exist: ' + flags.root + '\n')
    return 2
  }

  // ---- workspace-scoped commands, which operate on a container rather than one repo ----

  if (cmd === 'workspace' || cmd === 'edges' || (cmd === 'verify' && flags.workspace)) {
    const ws = findWorkspace(start)
    if (!ws) {
      say({
        error: 'not a workspace',
        start: path.resolve(start),
        hint: 'A workspace is a directory holding 2+ git repos. A single repo, or a folder of ' +
              'unrelated products, is not one. Add .claude-workspace.json to declare it explicitly.'
      })
      return 4
    }

    if (cmd === 'workspace') return workspaceCmd(ws)
    if (cmd === 'edges') return edgesCmd(ws, flags)

    // verify --workspace: every repo, plus the container's own workspace map.
    const opts = { maxAgeDays: flags.maxAge }
    const results = ws.repos.map(r => ({ repo: r.name, ...verifyMaps(r.path, opts) }))
    const wsLevel = verifyMaps(ws.root, opts)
    const ok = results.every(r => r.ok) && wsLevel.ok
    say({ root: ws.root, ok, workspaceMap: wsLevel, repos: results })
    return ok ? 0 : 1
  }

  // ---- repo-scoped commands ----

  if (!['scan', 'update', 'verify', 'gitignore'].includes(cmd)) {
    process.stderr.write(USAGE)
    return 2
  }

  // Refuse outside a repo rather than falling back to the start directory. A container of
  // unrelated repos (e.g. ~/Projects) would otherwise scan tens of thousands of files and
  // report several stacks as if they were one system.
  const root = findRepoRoot(start)
  if (root === null) {
    say({
      error: 'not a git repository',
      start: path.resolve(start),
      hint: 'Run from inside a repo. A folder holding several repos is not itself a repo.'
    })
    return 3
  }

  if (cmd === 'scan') return scanCmd(root, flags)
  if (cmd === 'update') return updateCmd(root, flags)
  if (cmd === 'verify') {
    const r = verifyMaps(root, { maxAgeDays: flags.maxAge })
    say({ root, ...r })
    return r.ok ? 0 : 1
  }
  const r = flags.write ? ensureGitignore(root) : gitignoreStatus(root)
  say({ root, ...r })
  return 0
}

// Run the CLI only when executed directly, not when imported by the test suite.
// MUST remain the last statement in this file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(cli(process.argv.slice(2)))
}
