# Ledger: subagent-strip-out

Plan: `.claude/plans/FEATURE_PLAN_subagent-strip-out.md`

Rollup: fix rounds=0 | cumulative tokens=16500/350000 | tasks: claude-skills=10, external=1

STAT | task=1 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1500
STAT | task=2 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1500
STAT | task=3 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1500
STAT | task=4 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1500
STAT | task=5 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1500
STAT | task=6 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1500
STAT | task=7 | score=2 | repo=external:~/.claude/CLAUDE.md | round=1 | status=DONE | tokens=1500
STAT | task=8 | score=2 | repo=claude-skills | round=1 | status=DONE | tokens=1500 | note=M5 repo-wide grep, all hits classified clean/sanctioned/historical except tooling/ drift
STAT | task=9 | score=3 | repo=claude-skills | round=1 | status=DONE | tokens=1500 | note=fixed stale _driftSnapshot in tooling/config/complexity-scoring.json (unplanned, outside manifest, required for validation gate)
STAT | task=10 | score=3 | repo=claude-skills | round=1 | status=DONE | tokens=1500 | note=user-approved follow-through: redesigned modelForGate('taskLevel') to return guidance not a stale haiku/sonnet/opus dispatch tier; dropped haiku45 + pricing from models; updated tests and tooling/README.md

Validation gate: node tooling/run-tests.mjs = 76/76 pass. node map-codebase/run-tests.mjs = 114/121 pass, 7 fail — confirmed pre-existing on unmodified main (same failures with this branch's changes stashed), all CLI-subprocess workspace tests unrelated to this item's file manifest. Not a regression; not blocking.

Manual code-review pass (code-review skill disabled for invocation this session): reviewed full diff file-by-file. Caught one leftover: README.md's complexity-scoring.md description still said "IDs, context windows, prices" after M1's live-sync dropped Haiku + pricing/context columns from the model reference table — fixed to "Opus 5 / Sonnet 5 IDs". Confirmed no SKILL.md frontmatter lists Workflow in allowed-tools. Re-ran tooling/run-tests.mjs after the fix: still 76/76.
STAT | task=11 | score=1 | repo=claude-skills | round=1 | status=DONE | tokens=1000 | note=manual code-review pass, fixed one stale README line
