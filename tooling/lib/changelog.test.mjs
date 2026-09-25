import { test } from '../../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureGitignored, appendEntry } from './changelog.mjs'

function tempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-'))
}

// ---------------------------------------------------------------- ensureGitignored

test('ensureGitignored creates .gitignore and adds the entry when missing', () => {
  const root = tempDir()
  ensureGitignored(root, 'changes.md')
  const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.deepEqual(content.split(/\r?\n/).filter(Boolean), ['changes.md'])
})

test('ensureGitignored appends to an existing .gitignore without a trailing newline', () => {
  const root = tempDir()
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/')
  ensureGitignored(root, 'changes.md')
  const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.deepEqual(content.split(/\r?\n/).filter(Boolean), ['node_modules/', 'changes.md'])
})

test('ensureGitignored is idempotent: calling it twice adds no duplicate line', () => {
  const root = tempDir()
  ensureGitignored(root, 'changes.md')
  ensureGitignored(root, 'changes.md')
  const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.deepEqual(content.split(/\r?\n/).filter(Boolean), ['changes.md'])
})

test('ensureGitignored leaves the file alone when the entry is already present', () => {
  const root = tempDir()
  fs.writeFileSync(path.join(root, '.gitignore'), 'changes.md\nnode_modules/\n')
  ensureGitignored(root, 'changes.md')
  const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.deepEqual(content.split(/\r?\n/).filter(Boolean), ['changes.md', 'node_modules/'])
})

// ---------------------------------------------------------------- appendEntry

test('appendEntry creates the file and writes a header + bullets', () => {
  const root = tempDir()
  appendEntry(root, { date: '2026-09-22', tickets: ['123'], bullets: ['Did the thing'] })
  const content = fs.readFileSync(path.join(root, 'changes.md'), 'utf8')
  assert.equal(content, '## 2026-09-22 — 123\n- Did the thing\n')
})

test('appendEntry formats the header with space-joined tickets and one bullet line each', () => {
  const root = tempDir()
  appendEntry(root, { date: '2026-09-22', tickets: ['123', '456'], bullets: ['One', 'Two'] })
  const content = fs.readFileSync(path.join(root, 'changes.md'), 'utf8')
  assert.equal(content, '## 2026-09-22 — 123 456\n- One\n- Two\n')
})

test('appendEntry called twice never truncates or rewrites prior content', () => {
  const root = tempDir()
  appendEntry(root, { date: '2026-09-20', tickets: [], bullets: ['First entry'] })
  appendEntry(root, { date: '2026-09-22', tickets: [], bullets: ['Second entry'] })
  const content = fs.readFileSync(path.join(root, 'changes.md'), 'utf8')
  const firstIdx = content.indexOf('First entry')
  const secondIdx = content.indexOf('Second entry')
  assert.ok(firstIdx >= 0 && secondIdx > firstIdx)
  assert.ok(content.startsWith('## 2026-09-20'))
})

test('appendEntry inserts a trailing newline before appending when the existing file lacks one', () => {
  const root = tempDir()
  fs.writeFileSync(path.join(root, 'changes.md'), '## 2026-09-20 — \n- No trailing newline here')
  appendEntry(root, { date: '2026-09-22', tickets: [], bullets: ['New entry'] })
  const content = fs.readFileSync(path.join(root, 'changes.md'), 'utf8')
  assert.ok(content.includes('- No trailing newline here\n## 2026-09-22'))
  assert.ok(!content.includes('here## 2026-09-22'))
})
