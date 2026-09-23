// git-orchestration.mjs — mechanical git sequencing for cleanup-crew steps 1-4.
// Never resolves a conflict, never runs `git stash drop`, never auto-picks a side.
// Only detects and reports; the human/Claude side keeps the two hard pauses.
import { execFileSync } from 'node:child_process'

function run (root, args) {
  try {
    const stdout = execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, stdout: stdout.toString(), stderr: '' }
  } catch (e) {
    return { ok: false, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() }
  }
}

/** `git status --porcelain`, parsed into { clean, entries: [{status, path}] }. */
export function statusShort (root) {
  const r = run(root, ['status', '--porcelain'])
  const entries = r.stdout.split('\n').filter(Boolean).map(line => ({
    status: line.slice(0, 2),
    path: line.slice(3)
  }))
  return { clean: entries.length === 0, entries }
}

/** `git stash push -u`. `stashed: false` when there was nothing to stash. */
export function stashPush (root) {
  const r = run(root, ['stash', 'push', '-u'])
  const message = (r.stdout.trim() || r.stderr.trim())
  const stashed = r.ok && !/No local changes to save/i.test(message)
  return { stashed, message }
}

/**
 * Deterministic, locale-independent check for whether `baseBranch` has an upstream, via
 * plumbing rather than parsing `git pull`'s human-readable failure text.
 */
function hasUpstream (root, baseBranch) {
  return run(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${baseBranch}@{u}`]).ok
}

/**
 * `git checkout <baseBranch>` then `git pull`, pre-checking upstream existence before ever
 * invoking `pull` so a repo with no tracking branch fails fast instead of via a subprocess
 * round-trip. On failure of either step, returns the raw git error verbatim — never classified.
 */
export function checkoutAndPull (root, baseBranch) {
  const co = run(root, ['checkout', baseBranch])
  if (!co.ok) return { ok: false, step: 'checkout', stderr: co.stderr }
  if (!hasUpstream(root, baseBranch)) {
    return { ok: false, step: 'pull', stderr: `no upstream configured for ${baseBranch}` }
  }
  const pull = run(root, ['pull'])
  if (!pull.ok) return { ok: false, step: 'pull', stderr: pull.stderr }
  return { ok: true }
}

/** `git checkout -b <name>`. */
export function createBranch (root, name) {
  const r = run(root, ['checkout', '-b', name])
  return r.ok ? { ok: true } : { ok: false, stderr: r.stderr }
}

const UNMERGED_CODES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'UD', 'DU'])

/**
 * `git stash pop`, then always re-checks `git status --porcelain` for unmerged codes to build
 * `conflictedFiles` — porcelain codes are stable across git versions/locales, unlike `stash
 * pop`'s human-readable stdout. Never calls `git stash drop`, under any outcome.
 */
export function stashPop (root) {
  const r = run(root, ['stash', 'pop'])
  const conflictedFiles = statusShort(root).entries
    .filter(e => UNMERGED_CODES.has(e.status))
    .map(e => e.path)
  // `raw` only on failure: a clean pop's stdout is a full `git status` listing nobody reads.
  const out = { conflict: conflictedFiles.length > 0, conflictedFiles }
  if (!r.ok) out.raw = r.stdout || r.stderr
  return out
}
