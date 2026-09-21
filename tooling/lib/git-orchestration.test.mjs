import { test } from '../../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { statusShort, stashPush, checkoutAndPull, createBranch, stashPop } from './git-orchestration.mjs'

function git (cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}

function initRepo () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitorch-'))
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['config', 'core.autocrlf', 'false'])
  git(root, ['checkout', '-q', '-b', 'main'])
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n')
  git(root, ['add', 'a.txt'])
  git(root, ['commit', '-q', '-m', 'init'])
  return root
}

/** A repo with `origin` pointing at a real local bare repo, `main` pushed and tracked. */
function withBareOrigin () {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gitorch-bare-'))
  git(bare, ['init', '-q', '--bare'])
  const root = initRepo()
  git(root, ['remote', 'add', 'origin', bare])
  git(root, ['push', '-q', '-u', 'origin', 'main'])
  return { root, bare }
}

// ---------------------------------------------------------------- statusShort

test('statusShort reports a clean tree', () => {
  const root = initRepo()
  assert.deepEqual(statusShort(root), { clean: true, entries: [] })
})

test('statusShort reports modified and untracked entries', () => {
  const root = initRepo()
  fs.appendFileSync(path.join(root, 'a.txt'), 'two\n')
  fs.writeFileSync(path.join(root, 'new.txt'), 'x')
  const result = statusShort(root)
  assert.equal(result.clean, false)
  const paths = result.entries.map(e => e.path)
  assert.ok(paths.includes('a.txt'))
  assert.ok(paths.includes('new.txt'))
})

// ---------------------------------------------------------------- stashPush

test('stashPush stashes tracked and untracked changes', () => {
  const root = initRepo()
  fs.appendFileSync(path.join(root, 'a.txt'), 'two\n')
  fs.writeFileSync(path.join(root, 'new.txt'), 'x')
  const result = stashPush(root)
  assert.equal(result.stashed, true)
  assert.equal(statusShort(root).clean, true)
})

test('stashPush reports nothing to stash on a clean tree', () => {
  const root = initRepo()
  const result = stashPush(root)
  assert.equal(result.stashed, false)
})

// ---------------------------------------------------------------- checkoutAndPull

test('checkoutAndPull pulls a commit pushed to origin by someone else', () => {
  const { root, bare } = withBareOrigin()
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'gitorch-other-'))
  git(other, ['clone', '-q', bare, '.'])
  git(other, ['config', 'user.email', 'test2@example.com'])
  git(other, ['config', 'user.name', 'Test2'])
  // The bare repo's HEAD still points at its own init-time default branch (not necessarily
  // 'main'), so the clone's checkout can land somewhere else even though 'main' was pushed.
  git(other, ['checkout', '-q', '-B', 'main', 'origin/main'])
  fs.writeFileSync(path.join(other, 'b.txt'), 'two\n')
  git(other, ['add', 'b.txt'])
  git(other, ['commit', '-q', '-m', 'add b'])
  git(other, ['push', '-q', 'origin', 'main'])

  const result = checkoutAndPull(root, 'main')
  assert.equal(result.ok, true)
  assert.ok(fs.existsSync(path.join(root, 'b.txt')))
})

test('checkoutAndPull surfaces the raw checkout error for a missing branch', () => {
  const root = initRepo()
  const result = checkoutAndPull(root, 'does-not-exist')
  assert.equal(result.ok, false)
  assert.equal(result.step, 'checkout')
  assert.ok(result.stderr.length > 0)
})

test('checkoutAndPull pre-check catches a missing upstream without ever calling pull', () => {
  const root = initRepo()
  git(root, ['checkout', '-q', '-b', 'feature'])
  git(root, ['checkout', '-q', 'main'])

  const result = checkoutAndPull(root, 'feature')
  assert.equal(result.ok, false)
  assert.equal(result.step, 'pull')
  // This exact message only comes from the pre-check, never from git pull's own stderr —
  // proof the pre-check short-circuited before a real `git pull` round-trip.
  assert.equal(result.stderr, 'no upstream configured for feature')
})

// ---------------------------------------------------------------- createBranch

test('createBranch creates and checks out a new branch', () => {
  const root = initRepo()
  const result = createBranch(root, 'feature/x')
  assert.equal(result.ok, true)
  assert.equal(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'feature/x')
})

test('createBranch surfaces the raw error when the branch already exists', () => {
  const root = initRepo()
  git(root, ['branch', 'dup'])
  const result = createBranch(root, 'dup')
  assert.equal(result.ok, false)
  assert.ok(result.stderr.length > 0)
})

// ---------------------------------------------------------------- stashPop

test('stashPop applies cleanly when nothing else touched the same lines', () => {
  const root = initRepo()
  fs.appendFileSync(path.join(root, 'a.txt'), 'two\n')
  stashPush(root)
  const result = stashPop(root)
  assert.equal(result.conflict, false)
  assert.deepEqual(result.conflictedFiles, [])
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\ntwo\n')
})

test('stashPop reports conflict with the right file when the stash collides with local changes', () => {
  const root = initRepo()
  // Branch B edits a.txt's one line differently and stashes it.
  git(root, ['checkout', '-q', '-b', 'branch-b'])
  fs.writeFileSync(path.join(root, 'a.txt'), 'from-b\n')
  const pushResult = stashPush(root)
  assert.equal(pushResult.stashed, true)
  git(root, ['checkout', '-q', 'main'])
  // Branch A (main) edits the same line differently and commits.
  fs.writeFileSync(path.join(root, 'a.txt'), 'from-a\n')
  git(root, ['add', 'a.txt'])
  git(root, ['commit', '-q', '-m', 'edit on a'])

  const result = stashPop(root)
  assert.equal(result.conflict, true)
  assert.deepEqual(result.conflictedFiles, ['a.txt'])
})
