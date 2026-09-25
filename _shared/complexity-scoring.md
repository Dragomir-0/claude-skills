# Complexity Scoring

This file is read by `plan-feature` and `execute-plan` — the only place the complexity rubric is
defined, so both skills score the same way and a score means the same thing wherever it's shown.
It complements `pipeline-contract.md`, not replaces it.

**No pipeline skill ever spawns a subagent.** Every score below feeds a recommendation on which
model the interactive session itself should be running as, or how much verification rigor a task
deserves — never a dispatch tier, since nothing is ever dispatched.

The rubric is used at two different grains:

- **Feature-level** (`plan-feature`, at ingestion) — how hard is *this whole request* to design?
  Feeds a recommendation on which interactive model the planning work should run under.
- **Task-level** (`execute-plan`, at decompose) — how hard is *this one atomic task* to implement?
  Feeds how much verification rigor it gets, and whether to flag that the session should be
  running a stronger model before implementing it.

Same four factors, same 1-10 scale, applied at whichever grain the calling skill is working at.

---

## Model reference

**This table is the single source of truth for interactive-session model IDs across every
pipeline skill.** Every gate below (feature-level, task-level, grading-level, map-level) names one
of these two — there is no third, cheaper tier, since no skill ever runs anything outside the
interactive session.

| Tier | Model ID |
|---|---|
| Opus 5 | `claude-opus-5` |
| Sonnet 5 | `claude-sonnet-5` |

**Fable 5.1 (`claude-fable-5-1`) is deliberately not used.** It is the most capable model available
and the most expensive. Opus 5 is this pipeline's ceiling by choice, not by oversight: nothing in
planning or execution has yet been shown to fail at Opus 5 in a way Fable 5.1 would fix. Revisit
only with evidence of a specific Opus 5 failure, never as a default upgrade.

---

## The four factors

Score each 1-10. Anchor against these descriptions rather than guessing a number — consistency
across runs is the entire value of a shared rubric.

**Scope / size** — how much surface area is in play.
- 1-2: one line, one file, no ripple effects
- 3-4: a single file or component, self-contained
- 5-6: several files, or one full feature within a module
- 7-8: multiple modules or services, or a change with wide blast radius
- 9-10: cross-cutting, touching many systems or the project's core architecture

**Ambiguity** — how well-specified the thing being scored is, *after* asking about anything
unclear (see below — never score around an open question instead of resolving it).
- 1-2: fully explicit, one reasonable interpretation
- 3-4: minor gaps, safe to fill with a stated assumption
- 5-6: real gaps that had to be asked about before this score was possible
- 7-8: still underspecified after asking — open-ended goal, no clear acceptance criteria
- 9-10: closer to "explore this space" than a defined piece of work

**Technical / dependency risk** — how costly a mistake would be, and how much sits outside this
skill's control.
- 1-2: fully reversible, isolated, no external dependency
- 3-4: reversible but touches shared code
- 5-6: hard to reverse (data, published artifacts, shared infra) or depends on another repo/team
- 7-8: production-impacting, security/data-loss potential, or blocked on external input
- 9-10: high-stakes and largely outside this run's control — coordination, compliance, irreversible risk

**Uncertainty / research needed** — how much investigation is needed before the work is even well
understood.
- 1-2: the approach is already known
- 3-4: a quick look at the code/docs settles it
- 5-6: unfamiliar library, pattern, or codebase area — real investigation needed
- 7-8: the right approach isn't clear yet; multiple viable strategies exist
- 9-10: genuinely open — no known approach going in

**Overall score** = round(average of the four factors). Ties round up.

- **1-3 — Low**
- **4-6 — Medium**
- **7-10 — High**

## Resolving ambiguity before scoring

Never round a factor down to keep the total low, Ambiguity least of all — that just means the
question wasn't asked yet. The same conflict of interest applies to all four: the model scoring its
own task has an incentive to under-score whichever factor would trigger a model-switch it would
rather avoid. When genuinely uncertain between two adjacent values for any factor, round up. Each
calling skill already has its own hook for resolving open questions before scoring, so don't
duplicate it here, just don't skip it:

- `plan-feature`'s ingestion step already has the empty-ticket rule and the vague-description rule
  — satisfy those before scoring, not instead of scoring.
- `execute-plan`'s atomic task briefs come from an approved plan and should already be unambiguous.
  If one genuinely isn't, that's a plan defect, not something to guess past — escalate it per
  `execute-plan`'s own regression/plan-defect handling rather than scoring around the gap.

## Showing the score

Keep it short — one line per factor, with a one-clause reason, not a paragraph:

```
Complexity: 6/10 (Medium)
- Scope/size: 6 — touches three files across two modules
- Ambiguity: 3 — acceptance criteria clear after clarifying the target format
- Technical/dependency risk: 7 — modifies shared auth middleware
- Uncertainty: 5 — unfamiliar library, needs a quick look at its docs
```

---

## Feature-level use (plan-feature, at ingestion)

Score once, right after the request is unambiguous and before map contextualisation — this is a
read on how hard the *design* work is, separate from each tier's own Complexity (1-5) / effort-band
(S/M/L/XL) scoring in §3, which sizes *implementation* once tiers already exist.

This gate uses its own two bands, not the Low/Medium/High display tiers above — a 7 and an 8 sit
one point apart but land on opposite sides of the model requirement:

| Score | Required model |
|---|---|
| 1-7 | Sonnet 5, no subagents |
| 8-10 | Opus 5, no subagents |

`plan-feature` never dispatches subagents at any score — this is purely about which model the
interactive session itself must be running as for the design work. If the session isn't already at
or above the required tier, tell the user the score and ask them to switch (`/model`) before
continuing; wait rather than proceeding on a lower tier by default. If they explicitly choose to
proceed anyway, note in the plan that it was designed below the required tier.

## Task-level use (execute-plan, at decompose)

Score each atomic task against its own brief (not the whole milestone), using the same four
factors. `execute-plan` never dispatches — it implements and verifies every task itself, in the
session — so the score feeds two things instead of a dispatch tier:

| Score | What the score means |
|---|---|
| 1-3 | Mechanical; verify with a normal-pace read (§3's verification pass, unchanged in depth). |
| 4-7 | Real judgment involved; verify a little more slowly, re-deriving intent from the brief before checking the diff. |
| 8-10 | This is exactly the difficulty band the pipeline used to reserve for the controller alone, never a capped subagent — before implementing it, tell the user the score and ask whether the session should be running Opus 5 tier, the same gate `plan-feature` applies at design time. |

Record the score on the task's ledger line (`score=<n>`) so a resumed run and any later review can
see how much scrutiny a task got without re-deriving the judgment call.

## Grading-level use (test-feature, kevin)

Neither skill computes its own complexity score — both reuse the **feature-level** score
`plan-feature` already wrote into the plan's `**Complexity:**` header line, so grading rigor tracks
design rigor without a second scoring pass.

| Plan complexity | Mode | Required session model |
|---|---|---|
| any | test-feature optimism 1-3; kevin `--plan`/`--domain` | Sonnet 5 |
| 8-10 | test-feature optimism 4-5 | Opus 5 |
| 4-7 (or no plan / no `**Complexity:**` line) | test-feature optimism 4-5 | Sonnet 5 |
| kevin `--e2e`, map lists ~5 domains or fewer | kevin `--e2e` | Sonnet 5 |
| kevin `--e2e`, map lists more than ~5 domains | kevin `--e2e` | Opus 5 |

Same protocol as the feature-level gate: check the session's actual model against the required
tier before doing the substantive grading; if it falls short, tell the user and ask them to switch
(`/model`), waiting rather than proceeding by default — the `--e2e` Opus floor past ~5 domains is a
hard requirement, not a recommendation the model can silently skip. If they explicitly choose to
proceed anyway, note it in the report header, the same way `plan-feature` notes a below-tier design.

**Split-execution alternative for the >~5-domain row.** The Opus floor attaches to the *aggregate*
judgment call — cross-referencing findings from many domains into one cross-domain journey and one
consolidated verdict (kevin §6.3-6.5) — not to covering many domains at all. A session may instead
run each domain's coverage (kevin §6.2: the flow-by-flow persona pass and that domain's own UI/UX
rating) as a separate pass, scored under the flat Sonnet-5 floor the row above already gives
`kevin --domain`, one domain at a time. Only the cross-domain journey and the final consolidation
into one report plus `ONBOARDING.md` still require Opus 5 — now over a much smaller judgment call
than grading every domain from scratch would be. This does not lower the bar: the synthesis step is
still gated at Opus 5 exactly as before, and running *that* step below Opus 5 is exactly the "just
this once" the paragraph above forbids. See kevin's §0b and §6.1 for the mechanics of offering and
running this.

Neither skill dispatches subagents at any tier — this gate is purely about the interactive
session's own model, identical in spirit to the feature-level gate above.

## Map-level use (map-codebase)

`map-codebase` has no complexity score to peg to — no feature or task exists yet when a map is
built or refreshed — so this gate is a flat floor rather than a table:

| Mode | Required session model |
|---|---|
| Full build, `--update` | Sonnet 5 |
| `--verify` | none — a zero-token deterministic script check, no model reasoning involved |

Writing a domain map is judgment work (deciding whether a doc or a directory name wins, synthesizing
`## Flow:` narratives, enumerating side effects correctly) whose failure mode is a confidently-wrong
map that poisons every plan built on it downstream. Same protocol as above: check the session's
actual model before doing the substantive work; if it falls short, tell the user and ask them to
switch (`/model`), waiting rather than proceeding by default. If they explicitly choose to proceed
anyway, note it in `index.md`'s header.
