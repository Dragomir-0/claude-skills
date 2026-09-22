# Roadmap — local-tooling-extraction

Extracting the codeable, non-judgment steps of the 6-skill Claude Code pipeline into plain Node
scripts under `tooling/` (nested in this repo), so only the parts that genuinely need judgment
stay LLM-driven. See `.claude/plans/FEATURE_PLAN_complexity-scoring-config.md` for the initiative's
first plan and its full context.

| Name | Title | Status | Plan |
|---|---|---|---|
| complexity-scoring-config | Complexity-scoring config + lookup module | Done | `.claude/plans/FEATURE_PLAN_complexity-scoring-config.md` |
| git-orchestration | Git orchestration module (stash/branch/pull/conflict-detect) | Done | `.claude/plans/FEATURE_PLAN_git-orchestration.md` |
| commit-composer | Commit composer + guarded push module | Done | `.claude/plans/FEATURE_PLAN_commit-composer.md` |
| changelog-helper | changes.md gitignore + append-only entry helper | Done | `.claude/plans/FEATURE_PLAN_changelog-helper.md` |
| plan-pruning | Finished-plan ledger pruning scanner | Done | `.claude/plans/FEATURE_PLAN_plan-pruning.md` |
| cross-repo-table | Cross-repo summary table formatter | Done | `.claude/plans/FEATURE_PLAN_cross-repo-table.md` |
| subagent-strip-out | Finish stripping subagent dispatch from skills + gate CLAUDE.md's ban | Active | `.claude/plans/FEATURE_PLAN_subagent-strip-out.md` |
