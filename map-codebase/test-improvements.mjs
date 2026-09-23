// Regression tests for the defects found in the map-codebase audit.
// Each test names the finding it locks down. Run with: node run-tests.mjs
import { test } from './harness.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  listFiles, buildTree, citedPaths, verifyMaps, changedFiles, lintMapText, mapHeader,
  mapOwnership, assignChanges, detectStacks, detectInfra, findEntryPoints, findTestAndCi,
  gitignoreStatus, ensureGitignore, parseArgs, discoverEdges
} from './map.mjs'

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'map.mjs')

function fixture (layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mapimp-'))
  for (const [rel, body] of Object.entries(layout)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body)
  }
  return root
}

/** A real git repo with one commit, so git-backed code paths are exercised for real. */
function gitFixture (layout, { commit = true } = {}) {
  const root = fixture(layout)
  const g = a => execFileSync('git', a, { cwd: root, stdio: 'pipe' })
  g(['init', '-q'])
  g(['config', 'user.email', 'test@example.com'])
  g(['config', 'user.name', 'test'])
  g(['config', 'commit.gpgsign', 'false'])
  if (commit) {
    g(['add', '-A'])
    g(['commit', '-qm', 'init'])
  }
  return { root, git: g, head: () => g(['rev-parse', 'HEAD']).toString().trim() }
}

function runCli (args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { stdio: 'pipe' }).toString() }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '').toString(), err: (e.stderr || '').toString() }
  }
}

// ---------------------------------------------------------------- #17 gitignore-aware walking

test('#17 listFiles honours .gitignore instead of a hardcoded prune list', () => {
  const { root } = gitFixture({
    '.gitignore': 'secretstuff/\ncustombuild/\n',
    'src/app.py': 'x',
    'secretstuff/lib/a.py': 'junk',
    'custombuild/out.js': 'junk'
  })
  const files = listFiles(root)
  assert.ok(files.includes('src/app.py'))
  assert.ok(!files.some(f => f.startsWith('secretstuff/')), 'gitignored dir must not be listed')
  assert.ok(!files.some(f => f.startsWith('custombuild/')), 'gitignored dir must not be listed')
})

test('#17 a vendored module does not invent a stack', () => {
  const { root } = gitFixture({
    '.gitignore': 'thirdparty/\n',
    'src/App.csproj': '',
    'thirdparty/dep/go.mod': 'module dep'
  })
  assert.deepEqual(detectStacks(listFiles(root)), ['dotnet'])
})

test('#17 listFiles falls back to walk() when git cannot answer', () => {
  const root = fixture({ '.git/HEAD': '', 'src/a.cs': '' })
  assert.deepEqual(listFiles(root), ['src/a.cs'])
})

test('#17 listFiles refuses to report an enclosing repo files for a subdirectory', () => {
  const { root } = gitFixture({ 'sub/a.cs': '', 'top.cs': '' })
  // sub/ is not a repo root, so git's answer must be rejected and walk() used instead.
  assert.deepEqual(listFiles(path.join(root, 'sub')), ['a.cs'])
})

// -------------------------------------------------------------------- #2 directory structure

test('#2 buildTree summarises directory shape with counts and extensions', () => {
  const t = buildTree([
    'src/api/A.cs', 'src/api/B.cs', 'src/api/C.cs',
    'src/web/x.ts', 'README.md'
  ])
  const api = t.dirs.find(d => d.dir === 'src/api')
  assert.equal(api.files, 3)
  assert.ok(api.exts[0].startsWith('.cs '))
  assert.ok(t.dirs.some(d => d.dir === '.'), 'root-level files get their own bucket')
  assert.equal(t.omitted, 0)
})

test('#2 buildTree caps the directory list and reports what it dropped', () => {
  const files = Array.from({ length: 60 }, (_, i) => `d${i}/x/f.cs`)
  const t = buildTree(files, { limit: 10 })
  assert.equal(t.dirs.length, 10)
  assert.equal(t.omitted, 50)
})

test('#2 scan emits a tree the model can carve domains from', () => {
  const { root } = gitFixture({ 'src/api/Program.cs': '', 'src/web/main.ts': '', 'App.csproj': '' })
  const json = JSON.parse(runCli(['scan', '--root', root]).out)
  assert.ok(Array.isArray(json.tree.dirs) && json.tree.dirs.length > 0, 'scan must report structure')
})

// ------------------------------------------------------------------ #1 bounded scan output

test('#1 scan caps its lists and says it did', () => {
  const layout = { 'App.csproj': '' }
  for (let i = 0; i < 40; i++) layout[`tests/T${i}/T${i}Tests.cs`] = ''
  for (let i = 0; i < 40; i++) layout[`docs/d${i}.md`] = ''
  const { root } = gitFixture(layout)
  const json = JSON.parse(runCli(['scan', '--root', root]).out)
  assert.ok(json.tests.length < json.testsTotal, 'tests list must be capped')
  assert.ok(json.projectDocs.length < json.projectDocsTotal, 'docs list must be capped')
  assert.ok(json.truncated, 'a capped payload must say so')
  assert.ok(json.testsTotal >= 40)
})

test('#1 --full restores the complete lists', () => {
  const layout = { 'App.csproj': '' }
  for (let i = 0; i < 40; i++) layout[`docs/d${i}.md`] = ''
  const { root } = gitFixture(layout)
  const json = JSON.parse(runCli(['scan', '--root', root, '--full']).out)
  assert.equal(json.projectDocs.length, json.projectDocsTotal)
  assert.ok(!json.truncated)
})

// ------------------------------------------------------------ #8/#9/#10/#11 verify precision

test('#8 a URL in a map is not mistaken for a repo path', () => {
  assert.deepEqual(citedPaths('See `https://api.example.com/v1/schema.json` for the shape.'), [])
})

test('#8 a Windows absolute path is not mistaken for a repo path', () => {
  assert.deepEqual(citedPaths('Local copy at `C:/Users/x/a.cs`.'), [])
})

test('#8 a URL in a map no longer fails verify', () => {
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/ARCHITECTURE_MAP.md':
      'Generated: 2999-01-01\n\nSchema at `https://example.com/v1/schema.json`, code at `src/a.cs`.'
  })
  const r = verifyMaps(root)
  assert.equal(r.ok, true, JSON.stringify(r.drift))
})

test('#9 a case-mismatched citation is drift, not a pass', () => {
  const { root } = gitFixture({
    'src/Program.cs': 'class P {}',
    '.claude/maps/ARCHITECTURE_MAP.md': 'Generated: 2999-01-01\n\nEntry at `src/program.cs`.'
  })
  const r = verifyMaps(root)
  assert.equal(r.ok, false, 'wrong-case citation must not pass')
  assert.equal(r.drift[0].reason, 'case mismatch')
  assert.equal(r.drift[0].actual, 'src/Program.cs')
})

test('#9 a correctly-cased citation still passes', () => {
  const { root } = gitFixture({
    'src/Program.cs': 'class P {}',
    '.claude/maps/ARCHITECTURE_MAP.md': 'Generated: 2999-01-01\n\nEntry at `src/Program.cs`.'
  })
  assert.equal(verifyMaps(root).ok, true)
})

test('#9 a gitignored file that is cited is not reported as drift', () => {
  const { root } = gitFixture({
    '.gitignore': 'generated/\n',
    'generated/Client.cs': 'x',
    '.claude/maps/ARCHITECTURE_MAP.md': 'Generated: 2999-01-01\n\nClient at `generated/Client.cs`.'
  })
  const r = verifyMaps(root)
  assert.equal(r.ok, true, JSON.stringify(r.drift))
})

test('#9 a file deleted from the working tree is drift even while git still tracks it', () => {
  // git ls-files reads the index, so a deleted-but-tracked file is still listed. Trusting that
  // list to decide existence let the commonest drift of all pass as clean.
  const { root } = gitFixture({
    'src/Gone.cs': 'x',
    '.claude/maps/x.md': 'Generated: 2999-01-01\n\nHandler at `src/Gone.cs`.'
  })
  fs.rmSync(path.join(root, 'src', 'Gone.cs'))
  const r = verifyMaps(root)
  assert.equal(r.ok, false, 'a deleted file must be drift')
  assert.equal(r.drift[0].reason, 'missing')
})

test('#10 a map with no citations is reported as empty', () => {
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/orders.md': 'Generated: 2999-01-01\n\nProse only, no citations.'
  })
  const r = verifyMaps(root)
  assert.deepEqual(r.emptyMaps, ['.claude/maps/orders.md'])
})

test('#10 index.md is exempt from the empty-map check', () => {
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/index.md': 'Generated: 2999-01-01\n\n## Search hints\n'
  })
  assert.deepEqual(verifyMaps(root).emptyMaps, [])
})

test('#11 a path with spaces is surfaced instead of silently dropped', () => {
  assert.deepEqual(
    citedPaths('Code at `src/My Project/Program.cs`.', { withSpaces: true }),
    ['src/My Project/Program.cs'])
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/ARCHITECTURE_MAP.md':
      'Generated: 2999-01-01\n\nCode at `src/My Project/Gone.cs` and `src/a.cs`.'
  })
  const r = verifyMaps(root)
  assert.equal(r.ok, true, 'a spaced path must never fail the commit gate')
  assert.equal(r.unverified.length, 1, 'but it must be reported')
})

test('#11 a shell command in backticks is never treated as a path', () => {
  for (const cmd of ['node ./scripts/build.js --watch', 'cat a/b.txt | grep x', 'rm -rf dist/x.js']) {
    assert.deepEqual(citedPaths('Run `' + cmd + '` first.', { withSpaces: true }), [], cmd)
  }
})

// ------------------------------------------------------ #12 Generated header and staleness

test('#12 mapHeader parses the date and the commit it described', () => {
  assert.deepEqual(mapHeader('# Map\n\nGenerated: 2026-08-27 (a1b2c3d)\n'),
    { generated: '2026-08-27', sha: 'a1b2c3d' })
  assert.deepEqual(mapHeader('# Map\n\n**Generated:** 2026-08-27\n'),
    { generated: '2026-08-27', sha: null })
  assert.deepEqual(mapHeader('# Map\n\nno header here\n'), { generated: null, sha: null })
})

test('#12 verify computes staleness deterministically', () => {
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/old.md': 'Generated: 2020-01-01\n\nCode at `src/a.cs`.',
    '.claude/maps/fresh.md': 'Generated: 2026-08-20\n\nCode at `src/a.cs`.'
  })
  const now = Date.parse('2026-08-27T00:00:00Z')
  const r = verifyMaps(root, { now })
  assert.ok(r.staleMaps.includes('.claude/maps/old.md'))
  assert.ok(!r.staleMaps.includes('.claude/maps/fresh.md'))
  assert.equal(r.maps.find(m => m.map.endsWith('fresh.md')).ageDays, 7)
  assert.equal(r.ok, true, 'staleness is reported, not a hard failure')
})

test('#12 a map with no Generated header counts as stale', () => {
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/x.md': 'Code at `src/a.cs`.'
  })
  assert.deepEqual(verifyMaps(root).staleMaps, ['.claude/maps/x.md'])
})

// -------------------------------------------------------------- #13 read-only guardrail lint

test('#13 a shell block in a map is a guardrail violation', () => {
  const hits = lintMapText('# Map\n\n```bash\ndotnet test\n```\n')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].kind, 'command')
})

test('#13 a mermaid block is not a violation', () => {
  assert.deepEqual(lintMapText('# Map\n\n```mermaid\ngraph TD\nA-->B\n```\n'), [])
})

test('#13 secret-shaped strings are caught', () => {
  assert.equal(lintMapText('token: ghp_' + 'a'.repeat(30) + '\n')[0].kind, 'secret')
  assert.equal(lintMapText('Server=x;Database=y;Password=hunter2\n')[0].kind, 'secret')
  assert.equal(lintMapText('AKIA' + 'A'.repeat(16) + '\n')[0].kind, 'secret')
})

test('#13 the Build & test commands section is the one exempt region', () => {
  const doc = '# Map\n\n## Build & test commands\n\n```bash\ndotnet test\n```\n'
  assert.deepEqual(lintMapText(doc), [], 'the declared commands section may carry commands')
  const after = '# Map\n\n## Build & test commands\n\n- x\n\n## Flows\n\n```bash\nrm -rf /\n```\n'
  assert.equal(lintMapText(after).length, 1, 'the exemption must not leak into the next section')
})

test('#13 a guardrail violation fails verify', () => {
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/x.md': 'Generated: 2999-01-01\n\nCode at `src/a.cs`.\n\n```bash\nrm -rf /\n```\n'
  })
  const r = verifyMaps(root)
  assert.equal(r.ok, false)
  assert.equal(r.guardrail[0].kind, 'command')
  assert.equal(runCli(['verify', '--root', root]).code, 1)
})

// ---------------------------------------------------------- #4 update against a real baseline

test('#4 update sees work committed since the map was generated', () => {
  // .claude/ is gitignored exactly as the skill's preflight arranges, so the maps themselves
  // never show up as "changed files".
  const f = gitFixture({
    '.gitignore': '.claude/\n', 'src/Orders/A.cs': 'v1', 'src/Billing/B.cs': 'v1'
  })
  const baseline = f.head().slice(0, 7)
  fs.mkdirSync(path.join(f.root, '.claude', 'maps'), { recursive: true })
  fs.writeFileSync(path.join(f.root, '.claude', 'maps', 'orders.md'),
    'Generated: 2026-08-01 (' + baseline + ')\n\nHandler at `src/Orders/A.cs`.\n')
  // Commit a change. Before the fix, `git diff HEAD` was empty and update reported nothing.
  fs.writeFileSync(path.join(f.root, 'src', 'Orders', 'A.cs'), 'v2')
  f.git(['add', '-A'])
  f.git(['commit', '-qm', 'change'])

  assert.deepEqual(changedFiles(f.root), [], 'vs HEAD there is genuinely nothing - the old bug')
  assert.deepEqual(changedFiles(f.root, baseline), ['src/Orders/A.cs'])

  const json = JSON.parse(runCli(['update', '--root', f.root]).out)
  assert.equal(json.changedTotal, 1)
  const m = json.maps.find(x => x.map.endsWith('orders.md'))
  assert.equal(m.regenerate, true)
  assert.deepEqual(m.changed, ['src/Orders/A.cs'])
})

test('#4 update warns when no map records a baseline commit', () => {
  const f = gitFixture({ 'src/a.cs': 'v1' })
  fs.mkdirSync(path.join(f.root, '.claude', 'maps'), { recursive: true })
  fs.writeFileSync(path.join(f.root, '.claude', 'maps', 'x.md'), 'Generated: 2026-08-01\n\n`src/a.cs`\n')
  const json = JSON.parse(runCli(['update', '--root', f.root]).out)
  assert.match(json.hint, /Generated:/)
})

// ------------------------------------------------------------------- #5 map ownership

test('#5 changed files are assigned to the map that cites them', () => {
  const owners = [
    { map: 'a.md', cited: ['src/Orders/A.cs'], prefixes: ['src/Orders/'] },
    { map: 'b.md', cited: ['src/Billing/B.cs'], prefixes: ['src/Billing/'] }
  ]
  const { byMap, unowned } = assignChanges(owners, ['src/Orders/A.cs', 'src/Billing/B.cs'])
  assert.deepEqual(byMap.get('a.md'), ['src/Orders/A.cs'])
  assert.deepEqual(byMap.get('b.md'), ['src/Billing/B.cs'])
  assert.deepEqual(unowned, [])
})

test('#5 a NEW file in a mapped domain is claimed by prefix, not left unowned', () => {
  const owners = [{ map: 'a.md', cited: ['src/Orders/A.cs'], prefixes: ['src/Orders/'] }]
  const { byMap, unowned } = assignChanges(owners, ['src/Orders/BrandNew.cs'])
  assert.deepEqual(byMap.get('a.md'), ['src/Orders/BrandNew.cs'])
  assert.deepEqual(unowned, [])
})

test('#5 a file in no mapped domain is reported as unowned', () => {
  const owners = [{ map: 'a.md', cited: ['src/Orders/A.cs'], prefixes: ['src/Orders/'] }]
  const { unowned } = assignChanges(owners, ['src/Shipping/New.cs'])
  assert.deepEqual(unowned, ['src/Shipping/New.cs'])
})

test('#5 the longest matching prefix wins', () => {
  const owners = [
    { map: 'broad.md', cited: ['src/A.cs'], prefixes: ['src/'] },
    { map: 'narrow.md', cited: ['src/Orders/A.cs'], prefixes: ['src/Orders/'] }
  ]
  const { byMap } = assignChanges(owners, ['src/Orders/New.cs'])
  assert.deepEqual(byMap.get('narrow.md'), ['src/Orders/New.cs'])
  assert.deepEqual(byMap.get('broad.md'), [])
})

test('#5 mapOwnership derives prefixes from citations', () => {
  const { root } = gitFixture({
    'src/Orders/A.cs': '',
    '.claude/maps/orders.md': 'Generated: 2026-08-01 (abc1234)\n\n`src/Orders/A.cs`\n'
  })
  const owners = mapOwnership(root)
  assert.equal(owners.length, 1)
  assert.deepEqual(owners[0].prefixes, ['src/Orders/'])
  assert.equal(owners[0].sha, 'abc1234')
})

// ----------------------------------------------------------------- #6 search-hints ledger

test('#6 scan reports the ledger so the next run reads it before searching', () => {
  const { root } = gitFixture({
    'src/a.cs': '',
    '.claude/maps/index.md':
      '# Index\n\n## Search hints\n\nassets -> src/Assets/ (verified 2026-08-01; ~200 tokens)\n'
  })
  const json = JSON.parse(runCli(['scan', '--root', root]).out)
  assert.equal(json.maps.exist, true)
  assert.equal(json.maps.searchHints, 1)
  assert.match(json.maps.readFirst, /before searching the filesystem/)
})

test('#6 scan says plainly when there are no maps yet', () => {
  const { root } = gitFixture({ 'src/a.cs': '' })
  const json = JSON.parse(runCli(['scan', '--root', root]).out)
  assert.equal(json.maps.exist, false)
})

// --------------------------------------------------------------- #18/#19/#20 detection gaps

test('#18 tsx and jsx entry points are found', () => {
  const found = findEntryPoints(['src/main.tsx', 'src/index.tsx', 'src/App.jsx', 'src/Thing.tsx'])
  assert.ok(found.includes('src/main.tsx'))
  assert.ok(found.includes('src/index.tsx'))
  assert.ok(found.includes('src/App.jsx'))
  assert.ok(!found.includes('src/Thing.tsx'), 'an ordinary component is not an entry point')
})

test('#18 entry points come back shallowest first so a cap keeps the likely ones', () => {
  const found = findEntryPoints(['a/b/c/d/index.ts', 'src/main.ts'])
  assert.deepEqual(found, ['src/main.ts', 'a/b/c/d/index.ts'])
})

test('#19 class-named test files and the remaining CI systems are detected', () => {
  const { tests, ci } = findTestAndCi([
    'src/OrderServiceTests.cs', 'src/FooTest.java', 'src/BarTests.kt',
    'app/test_thing.py', 'spec/models/user_spec.rb', 'src/Helper.cs',
    'Jenkinsfile', '.circleci/config.yml', 'bitbucket-pipelines.yml', '.travis.yml'
  ])
  for (const t of ['src/OrderServiceTests.cs', 'src/FooTest.java', 'src/BarTests.kt',
    'app/test_thing.py', 'spec/models/user_spec.rb']) {
    assert.ok(tests.includes(t), 'missing test file: ' + t)
  }
  assert.ok(!tests.includes('src/Helper.cs'))
  for (const c of ['Jenkinsfile', '.circleci/config.yml', 'bitbucket-pipelines.yml', '.travis.yml']) {
    assert.ok(ci.includes(c), 'missing CI file: ' + c)
  }
})

test('#20 infrastructure is detected, separately from application stacks', () => {
  assert.deepEqual(detectInfra(['main.tf', 'Dockerfile']), ['docker', 'terraform'])
  assert.deepEqual(detectInfra(['infra/main.bicep']), ['bicep'])
  assert.deepEqual(detectStacks(['main.tf', 'Dockerfile']), [], 'infra is not an app stack')
})

test('#20 deno is a recognised stack', () => {
  assert.deepEqual(detectStacks(['deno.json']), ['deno'])
})

test('#20 an unrecognised tree gets the hint; a Terraform-only repo does not', () => {
  const bare = gitFixture({ 'notes.txt': '' })
  assert.ok(JSON.parse(runCli(['scan', '--root', bare.root]).out).stackHint)
  const tf = gitFixture({ 'main.tf': 'resource "x" "y" {}' })
  const json = JSON.parse(runCli(['scan', '--root', tf.root]).out)
  assert.deepEqual(json.infra, ['terraform'])
  assert.equal(json.stackHint, undefined)
})

// ------------------------------------------------------------------------ #22 edge payload

test('#22 edge sites are capped by default and the true count is kept', () => {
  const root = fixture({ 'a/.git/HEAD': '', 'b/.git/HEAD': '' })
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(root, 'a', `f${i}.cs`), '[HttpGet("SharedThing")]')
  }
  fs.writeFileSync(path.join(root, 'b', 's.ts'), "http.get('/api/v1/SharedThing');")
  const repos = ['a', 'b'].map(n => ({ name: n, path: path.join(root, n) }))
  const e = discoverEdges(repos).edges.find(x => x.name === 'SharedThing')
  assert.ok(e, 'the shared route must still be found')
  assert.ok(e.sites.length <= 3, 'sites must be capped')
  assert.ok(e.siteCount > e.sites.length, 'the real count must survive the cap')
})

test('#22 php and vue sources are scanned for edges', () => {
  const root = fixture({
    'a/.git/HEAD': '', 'a/Api.php': "Route::get('/api/v1/Widgets/Detail');",
    'b/.git/HEAD': '', 'b/View.vue': "axios.get('/api/v1/Widgets/Detail')"
  })
  const repos = ['a', 'b'].map(n => ({ name: n, path: path.join(root, n) }))
  assert.ok(discoverEdges(repos).edges.some(e => e.name === 'Widgets'))
})

test('#22 edges --limit trims the list and says what it dropped', () => {
  const root = fixture({
    'a/.git/HEAD': '', 'a/C.cs': '[HttpGet("Alpha")]\n[HttpGet("Bravo")]\n[HttpGet("Charlie")]',
    'b/.git/HEAD': '', 'b/s.ts': "get('/api/v1/Alpha');get('/api/v1/Bravo');get('/api/v1/Charlie');"
  })
  const json = JSON.parse(runCli(['edges', '--root', root, '--limit', '2']).out)
  assert.equal(json.edges.length, 2)
  assert.ok(json.omitted >= 1)
  assert.ok(json.edgeCount >= 3, 'the full count is still reported')
})

// ------------------------------------------------------------------------ #23 argument parsing

test('#23 --root with no value is a clean usage error, not a stack trace', () => {
  const r = runCli(['scan', '--root'])
  assert.equal(r.code, 2)
  assert.match(r.err, /--root requires a value/)
  assert.ok(!/at Object/.test(r.err), 'must not print a node stack trace')
})

test('#23 a nonexistent --root is rejected', () => {
  const r = runCli(['scan', '--root', path.join(os.tmpdir(), 'definitely-not-here-1234')])
  assert.equal(r.code, 2)
  assert.match(r.err, /does not exist/)
})

test('#23 parseArgs validates numeric flags and rejects unknown ones', () => {
  assert.equal(parseArgs(['scan', '--sites', 'abc']).error, '--sites requires a non-negative number')
  assert.equal(parseArgs(['scan', '--bogus']).error, 'unknown flag --bogus')
  assert.deepEqual(parseArgs(['scan', '--root', 'x']).rest, ['scan'])
  assert.equal(parseArgs(['scan', '--root', 'x']).flags.root, 'x')
})

// ------------------------------------------------------------------------ #25 gitignore verb

test('#25 gitignore reports what is missing without writing', () => {
  const { root } = gitFixture({ '.gitignore': 'bin/\n' })
  const json = JSON.parse(runCli(['gitignore', '--root', root]).out)
  assert.deepEqual(json.missing, ['.claude/maps/', '.claude/plans/', '.claude/reports/'])
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'bin/\n')
})

test('#25 gitignore --write appends without disturbing what is there', () => {
  const { root } = gitFixture({ '.gitignore': 'bin/\nobj/\n' })
  runCli(['gitignore', '--root', root, '--write'])
  const text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.ok(text.startsWith('bin/\nobj/\n'), 'existing content must be preserved verbatim')
  for (const e of ['.claude/maps/', '.claude/plans/', '.claude/reports/']) assert.ok(text.includes(e))
  assert.deepEqual(gitignoreStatus(root).missing, [])
})

test('#25 gitignore --write is idempotent', () => {
  const { root } = gitFixture({ '.gitignore': 'bin/\n' })
  runCli(['gitignore', '--root', root, '--write'])
  const once = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  const second = ensureGitignore(root)
  assert.equal(second.written, false)
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), once)
})

test('#25 gitignore creates the file when the repo has none', () => {
  const { root } = gitFixture({ 'a.cs': '' })
  ensureGitignore(root)
  const text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.ok(text.includes('.claude/maps/'))
  assert.ok(!text.startsWith('\n'), 'a new file must not open with a blank line')
})

test('#25 a wholesale .claude ignore already covers all three', () => {
  const { root } = gitFixture({ '.gitignore': '.claude/\n' })
  assert.deepEqual(gitignoreStatus(root).missing, [])
})

// ---------------------------------------------------------------------- cross-cutting checks

test('scan on a repo stays small enough to be worth reading', () => {
  const layout = { 'App.csproj': '' }
  for (let i = 0; i < 300; i++) layout[`src/f${i}/Thing${i}.cs`] = 'class T {}'
  for (let i = 0; i < 300; i++) layout[`tests/T${i}Tests.cs`] = 'class T {}'
  const { root } = gitFixture(layout)
  const out = runCli(['scan', '--root', root]).out
  assert.ok(out.length < 20000, 'scan payload was ' + out.length + ' bytes; it must stay small')
  assert.equal(JSON.parse(out).testsTotal, 300, 'the true count still reaches the model')
})

test('exit codes are unchanged: 0 clean, 1 drift, 2 usage, 3 not a repo, 4 not a workspace', () => {
  const clean = gitFixture({ 'src/a.cs': '' })
  assert.equal(runCli(['verify', '--root', clean.root]).code, 0)

  const dirty = gitFixture({
    'src/a.cs': '',
    '.claude/maps/x.md': 'Generated: 2999-01-01\n\nGone: `src/Nope.cs`.'
  })
  assert.equal(runCli(['verify', '--root', dirty.root]).code, 1)
  assert.equal(runCli(['bogus']).code, 2)

  const notRepo = fixture({ 'repoA/src/a.cs': '' })
  assert.equal(runCli(['scan', '--root', notRepo]).code, 3)
  assert.equal(runCli(['workspace', '--root', clean.root]).code, 4)
})
