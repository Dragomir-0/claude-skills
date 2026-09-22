// changelog.mjs — mechanical changes.md gitignore + append-only entry helper for cleanup-crew step 5.
// Deciding what the bullets say stays with Claude/the user; this module only ensures the
// gitignore entry exists and appends correctly formatted, never-overwriting entries.
import fs from 'node:fs'
import path from 'node:path'

/**
 * Ensures `filename` is gitignored, as its own line, in `root`'s `.gitignore`. Creates the file
 * if absent. Idempotent — checks for an exact line match before appending, so calling this twice
 * never produces a duplicate entry.
 */
export function ensureGitignored (root, filename = 'changes.md') {
  const gitignorePath = path.join(root, '.gitignore')
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : ''
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : []
  if (lines.includes(filename)) return
  const needsNewline = existing.length > 0 && !/\r?\n$/.test(existing)
  fs.appendFileSync(gitignorePath, `${needsNewline ? '\n' : ''}${filename}\n`)
}

/**
 * Appends one dated entry — `## <date> — <tickets>` followed by one `- <bullet>` line per
 * bullet — to `filename`. Never truncates or rewrites existing content; creates the file if
 * absent. Guards against a missing trailing newline in existing content (a manual edit or an
 * editor that strips trailing newlines) by inserting exactly one before appending, so the new
 * entry's header never glues onto the end of the previous line.
 */
export function appendEntry (root, { date, tickets = [], bullets }, filename = 'changes.md') {
  const filePath = path.join(root, filename)
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const needsNewline = existing.length > 0 && !/\r?\n$/.test(existing)
  const header = `## ${date} — ${tickets.join(' ')}`
  const body = bullets.map(b => `- ${b}`).join('\n')
  fs.appendFileSync(filePath, `${needsNewline ? '\n' : ''}${header}\n${body}\n`)
}
