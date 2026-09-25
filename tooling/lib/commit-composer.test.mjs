import { test } from '../../map-codebase/harness.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { composeCommitArgs, formatCommand, runCommit, pushBranch } from './commit-composer.mjs'

function git (cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}

function initRepo () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commitcomp-'))
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
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'commitcomp-bare-'))
  git(bare, ['init', '-q', '--bare'])
  const root = initRepo()
  git(root, ['remote', 'add', 'origin', bare])
  git(root, ['push', '-q', '-u', 'origin', 'main'])
  return { root, bare }
}

// ---------------------------------------------------------------- composeCommitArgs

test('composeCommitArgs builds the 3-flag shape with tickets', () => {
  const argv = composeCommitArgs({ title: 'Fix thing', description: 'Because reasons', tickets: ['123', '456'] })
  assert.deepEqual(argv, ['commit', '-m', 'Fix thing', '-m', 'Because reasons', '-m', '#123 #456'])
})

test('composeCommitArgs omits the third -m entirely with no tickets', () => {
  const argv = composeCommitArgs({ title: 'Fix thing', description: 'Because reasons', tickets: [] })
  assert.deepEqual(argv, ['commit', '-m', 'Fix thing', '-m', 'Because reasons'])
})

test('composeCommitArgs defaults tickets to empty when omitted', () => {
  const argv = composeCommitArgs({ title: 'Fix thing', description: 'Because reasons' })
  assert.deepEqual(argv, ['commit', '-m', 'Fix thing', '-m', 'Because reasons'])
})

test('composeCommitArgs passes special characters through argv untouched', () => {
  const title = `Fix "quoted" thing's \\ path`
  const argv = composeCommitArgs({ title, description: 'multi\nline', tickets: [] })
  assert.equal(argv[2], title)
  assert.equal(argv[4], 'multi\nline')
})

// ---------------------------------------------------------------- formatCommand

test('formatCommand leaves plain tokens unquoted', () => {
  const cmd = formatCommand(['commit', '-m', 'Fix'])
  assert.equal(cmd, 'git commit -m Fix')
})

test('formatCommand quotes and escapes tokens containing spaces or quotes', () => {
  const cmd = formatCommand(['commit', '-m', 'Fix thing', '-m', `has "quotes"`])
  assert.equal(cmd, 'git commit -m "Fix thing" -m "has \\"quotes\\""')
})

// ---------------------------------------------------------------- runCommit

test('runCommit stages and commits real changes', () => {
  const root = initRepo()
  fs.writeFileSync(path.join(root, 'b.txt'), 'new file\n')
  const argv = composeCommitArgs({ title: 'Add b', description: 'adds b.txt', tickets: ['42'] })
  const result = runCommit(root, argv)
  assert.equal(result.ok, true)
  const log = git(root, ['log', '-1', '--pretty=%B'])
  assert.ok(log.includes('Add b'))
  assert.ok(log.includes('adds b.txt'))
  assert.ok(log.includes('#42'))
  assert.equal(git(root, ['status', '--porcelain']).trim(), '')
})

test('runCommit surfaces the raw error when there is nothing to commit', () => {
  const root = initRepo()
  const argv = composeCommitArgs({ title: 'Empty', description: 'nothing changed', tickets: [] })
  const result = runCommit(root, argv)
  assert.equal(result.ok, false)
  assert.equal(result.step, 'commit')
  assert.ok(result.stderr.length > 0)
})

// ---------------------------------------------------------------- pushBranch

test('pushBranch refuses main without touching git', () => {
  const root = initRepo() // no origin remote configured at all
  assert.throws(() => pushBranch(root, 'main'), /refusing to push protected branch: main/)
})

test('pushBranch refuses master without touching git', () => {
  const root = initRepo()
  assert.throws(() => pushBranch(root, 'master'), /refusing to push protected branch: master/)
})

test('pushBranch refuses a branch name that does not match the checked-out branch', () => {
  const { root, bare } = withBareOrigin() // currently checked out on 'main'
  assert.throws(() => pushBranch(root, 'feature/other'), /does not match branchName/)
  const refs = git(bare, ['for-each-ref', '--format=%(refname)'])
  assert.ok(!refs.includes('refs/heads/feature/other'))
})

test('pushBranch pushes a matching, non-protected branch to origin', () => {
  const { root, bare } = withBareOrigin()
  git(root, ['checkout', '-q', '-b', 'feature/x'])
  fs.writeFileSync(path.join(root, 'c.txt'), 'x')
  git(root, ['add', 'c.txt'])
  git(root, ['commit', '-q', '-m', 'add c'])
  const result = pushBranch(root, 'feature/x')
  assert.equal(result.ok, true)
  const refs = git(bare, ['for-each-ref', '--format=%(refname)'])
  assert.ok(refs.includes('refs/heads/feature/x'))
})
