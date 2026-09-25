// commit-composer.mjs — mechanical commit composition + guarded push for cleanup-crew step 7.
// Deciding the title, description and ticket list stays with Claude/the user; this module only
// builds the argv and enforces the two guardrails (never main/master, never forced).
import { execFileSync } from 'node:child_process'

function git (root, args) {
  try {
    const stdout = execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, stdout: stdout.toString(), stderr: '' }
  } catch (e) {
    return { ok: false, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() }
  }
}

/**
 * Pure. Builds `git commit` argv: the third `-m` (tickets) is fully omitted, not passed empty,
 * when `tickets` has no entries — matching the skill's exact instruction.
 */
export function composeCommitArgs ({ title, description, tickets = [] }) {
  const argv = ['commit', '-m', title, '-m', description]
  if (tickets.length > 0) {
    argv.push('-m', tickets.map(t => `#${t}`).join(' '))
  }
  return argv
}

/**
 * Pure. Human-readable, properly-quoted display string for approval purposes only — execution
 * never goes through this string, so there is no shell-quoting step to get wrong in the
 * execution path, only in the display path.
 */
export function formatCommand (argv) {
  const quote = s => (/[\s"'\\]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s)
  return ['git', ...argv.map(quote)].join(' ')
}

/**
 * `git add -A` then runs `argv` straight through `execFileSync`, never a shell. On failure,
 * surfaces stdout as a fallback — `git commit`'s own failure text (e.g. "nothing to commit")
 * goes to stdout, not stderr, unlike `checkout`/`pull`.
 */
export function runCommit (root, argv) {
  const add = git(root, ['add', '-A'])
  if (!add.ok) return { ok: false, step: 'add', stderr: add.stderr || add.stdout }
  const commit = git(root, argv)
  return commit.ok ? { ok: true } : { ok: false, step: 'commit', stderr: commit.stderr || commit.stdout }
}

/**
 * `git push -u origin <branchName>`. Throws before running anything if `branchName` is `main` or
 * `master` (case-sensitive), or if the currently checked-out branch doesn't match `branchName` —
 * both checked before any subprocess runs. Has no force-push parameter at all: "never force-push"
 * is structurally unreachable, not merely defaulted off.
 */
export function pushBranch (root, branchName) {
  if (branchName === 'main' || branchName === 'master') {
    throw new Error(`refusing to push protected branch: ${branchName}`)
  }
  const current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
  if (current !== branchName) {
    throw new Error(`checked-out branch (${current}) does not match branchName (${branchName})`)
  }
  const push = git(root, ['push', '-u', 'origin', branchName])
  return push.ok ? { ok: true } : { ok: false, stderr: push.stderr || push.stdout }
}
