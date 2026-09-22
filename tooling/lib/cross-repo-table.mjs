// cross-repo-table.mjs — formats the "repo, branch, commit hash, push result, PR URL" summary
// table that cleanup-crew's cross-repo mode reports at the end of a run. Pure formatting, no side
// effects: the caller accumulates one result row per repo as it works through them and hands the
// finished array to formatSummaryTable once. commit/pushResult may literally be the strings
// 'skipped' or 'aborted' instead of a real hash/result — rendered as plain text, so partial
// completion reads clearly in the table itself rather than being hidden behind special-casing.

const REQUIRED_FIELDS = ['repo', 'branch', 'commit', 'pushResult']

/**
 * Pure function. Takes `rows: [{ repo, branch, commit, pushResult, prUrl }]` and returns a
 * markdown table string with a `| Repo | Branch | Commit | Push | PR |` header and one row per
 * entry. A missing/undefined/null `prUrl` renders as `—` rather than an empty or `undefined`
 * cell. A row missing any of `repo`, `branch`, `commit`, or `pushResult` throws, naming the row
 * index and the missing field — this is a report people read to know what actually shipped
 * across several repos, so a silent gap is worse than a loud failure.
 */
export function formatSummaryTable (rows) {
  const lines = [
    '| Repo | Branch | Commit | Push | PR |',
    '|---|---|---|---|---|'
  ]

  rows.forEach((row, index) => {
    for (const field of REQUIRED_FIELDS) {
      if (row[field] === undefined || row[field] === null || row[field] === '') {
        throw new Error(`formatSummaryTable: row ${index} is missing required field "${field}"`)
      }
    }
    const prUrl = row.prUrl === undefined || row.prUrl === null || row.prUrl === '' ? '—' : row.prUrl
    lines.push(`| ${row.repo} | ${row.branch} | ${row.commit} | ${row.pushResult} | ${prUrl} |`)
  })

  return lines.join('\n')
}
