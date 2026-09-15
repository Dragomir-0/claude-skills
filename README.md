# Claude Code skills — the feature pipeline

My personal Claude Code skills: a six-skill pipeline that takes a feature from "I have an idea"
to "it's on a branch, reviewed and pushed" — with a UAT persona that can run standalone at any
point. Each stage is a slash command, writes exactly one kind of artifact, and hard-pauses for
me at the decisions that are mine to make.

```
/map-codebase  →  /plan-feature  →  /execute-plan  →  /test-feature  →  /cleanup-crew
   architecture      the plan         the code          the grade     ↘     the branch
                                                                        /kevin
                                                                        UAT, live frontend
```

| Skill | What it does | Writes |
|---|---|---|
| **`/map-codebase`** | Builds high-signal architecture maps so later sessions understand end-to-end feature flows without reading source. Gates the session's own model (Sonnet 5 floor) on a full build or `--update`; `--verify` is a zero-token drift check with no model floor. | architecture maps |
| **`/plan-feature`** | Turns an Azure DevOps ticket **or** a written description into a three-tier implementation plan with File Impact Manifests, scored effort, milestones and hard pauses. Scores feature complexity and gates the session's own model (Sonnet vs Opus). Never touches source. | the plan file |
| **`/execute-plan`** | Executes an approved plan milestone by milestone: decomposes into atomic tasks, scores each one and dispatches capped subagents (Haiku/Sonnet) via the `Workflow` tool under a hard token ceiling, verifies every result as controller, re-checks regressions, and stops at each milestone for me to test. `--roadmap` loops build/test-feature/kevin across every active roadmap item. | source + a ledger |
| **`/test-feature`** | Grades the implemented feature against its plan at a chosen rigour (`--optimism 1-5`), measuring real coverage at level 3+, and checking completeness, security, deployment, pipeline and efficiency. Never spawns subagents — the whole run stays in one evidence trail. Never touches source. | a test report |
| **`/kevin`** | Plays a careless first-time user through the live frontend — a feature, a whole map domain, or the entire project — deliberately mistyping and misclicking, and reports every bug, crash and confusing moment. Reads the plan/map, never source. | a bug report (+ onboarding doc) |
| **`/cleanup-crew`** | Stashes, branches off an up-to-date base, restores the work, refreshes docs, and drives a reviewed conventional commit and push ready for a PR. | a branch + commit |

`_shared/pipeline-contract.md` holds the artifact paths, repo resolution, `<Name>` derivation, cost
discipline and the dispatch-surface rules that these skills read, and
`_shared/complexity-scoring.md` holds the **model reference** (IDs, context windows, prices — the
single source of truth for every skill) plus the shared 4-factor rubric (scope, ambiguity, risk,
uncertainty; 1-10) that `plan-feature` and `execute-plan` score against — `test-feature` and `kevin` don't score anything themselves, but reuse that same
score (read from the plan header) to set their own minimum model tier, so grading rigor tracks
design rigor. **Neither shared file is optional** — the skills reference them by absolute path at
`~/.claude/skills/_shared/`.

---

## Install on a new machine

Skills are plain files; nothing syncs through the Claude account. Clone this repo *as* the
skills directory:

```bash
git clone https://github.com/Steelwool9925/claude-skills.git ~/.claude/skills
```

If `~/.claude/skills` already exists and has skills in it you want to keep, clone elsewhere and
copy instead:

```bash
git clone https://github.com/Steelwool9925/claude-skills.git /tmp/claude-skills
cp -r /tmp/claude-skills/{execute-plan,plan-feature,test-feature,map-codebase,cleanup-crew,kevin} ~/.claude/skills/
mkdir -p ~/.claude/skills/_shared
cp /tmp/claude-skills/_shared/{pipeline-contract.md,complexity-scoring.md} ~/.claude/skills/_shared/
```

On Windows the path is the same: `C:\Users\<you>\.claude\skills\`.

Restart Claude Code (or `/exit` and relaunch). Confirm with `/help` — the six commands should
be listed. The end state you want:

```
~/.claude/skills/
├── _shared/pipeline-contract.md
├── _shared/complexity-scoring.md
├── cleanup-crew/SKILL.md
├── execute-plan/SKILL.md
├── kevin/SKILL.md
├── map-codebase/         SKILL.md + map.mjs + 3 test scripts
├── plan-feature/SKILL.md
└── test-feature/SKILL.md
```

---

## Dependencies

### Required — the `superpowers` plugin

`/execute-plan` hands off to `superpowers:using-git-worktrees` for workspace isolation and
`superpowers:finishing-a-development-branch` when the work is done. Without the plugin,
`/execute-plan` loses its isolation step.

Install it from inside Claude Code:

```
/plugin
```

Add the `anthropics/claude-plugins-official` marketplace, then install **superpowers**.

### Required — Node

`/map-codebase` runs `map.mjs`. It imports Node builtins only (`node:fs`, `node:path`,
`node:child_process`, `node:url`), so there is **no `npm install`** — Node just has to be on PATH.

### Recommended — multi-agent opt-in, for `/execute-plan`, `/kevin` and `/map-codebase`

All three dispatch subagents via the `Workflow` tool: capped implementers and verifiers in
`/execute-plan`, Haiku-pinned artifact/report drafting in `/kevin`, Haiku-pinned map publishing in
`/map-codebase`. None of them *requires* it — without the opt-in `/execute-plan` degrades to
controller-only single-threaded execution, and `/kevin` and `/map-codebase` do their drafting and
publishing in-session. Every skill states which mode it ran in rather than degrading silently.

### Required — a browser surface, for `/kevin`

`/kevin` drives a real frontend and cannot run without one. It checks for **Claude in Chrome**
(`claude-in-chrome` skill + `mcp__claude-in-chrome__*`) first, then **Chrome DevTools MCP**
(`chrome-devtools-mcp:chrome-devtools` + `mcp__*chrome-devtools__*`), and stops if neither is
available. It never substitutes reading source or `curl` for actually driving the app.

### Optional — `ado-status`

`/plan-feature` accepts either an ADO work item or a plain written description. The `--ado <id>`
path shells out to `~/.claude/skills/ado-status/ado.ps1` and needs `AZURE_DEVOPS_ORG_URL` and
`AZURE_DEVOPS_PAT` set. That skill is **not** in this repo — skip it unless planning from Azure
DevOps tickets, and use the written-description path instead.

Note this path calls PowerShell. On a non-Windows machine it needs adjusting.

---

## Keeping both machines in sync

Because the clone *is* `~/.claude/skills`, editing a skill is editing the repo:

```bash
cd ~/.claude/skills
git add -A && git commit -m "tighten execute-plan verification" && git push
```

And on the other machine:

```bash
cd ~/.claude/skills && git pull
```

Skills are re-read at session start, so a `git pull` takes effect on the next Claude Code launch.

---

## What is deliberately *not* here

- **Plugin skills** (`superpowers`, `skill-creator`, `frontend-design`, `dataviz`, …) — these
  live in `~/.claude/plugins/cache/` and are reinstalled from the marketplace, not copied. Their
  install records store absolute paths that would be wrong on another machine.
- **`~/.claude/CLAUDE.md`** — global instructions (file-access rules, response format). Separate
  concern, worth copying by hand.
- **`~/.claude/settings.json`** — permissions and hooks. Copy with care: hook entries often
  reference absolute paths that will not exist on the new machine.
