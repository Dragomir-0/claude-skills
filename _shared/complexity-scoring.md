# Complexity Scoring

This file is read by `plan-feature` and `execute-plan` — the only place the complexity rubric is
defined, so both skills score the same way and a score means the same thing wherever it's shown.
It complements `pipeline-contract.md`, not replaces it.

The rubric is used at two different grains:

- **Feature-level** (`plan-feature`, at ingestion) — how hard is *this whole request* to design?
  Feeds a recommendation on which interactive model the planning work should run under.
- **Task-level** (`execute-plan`, at decompose) — how hard is *this one atomic task* to implement?
  Feeds which model tier a subagent gets dispatched at, or whether it's dispatched at all.

Same four factors, same 1-10 scale, applied at whichever grain the calling skill is working at.

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

Never round Ambiguity down to keep the total low — that just means the question wasn't asked yet.
Each calling skill already has its own hook for this, so don't duplicate it here, just don't skip
it:

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
factors. This *is* the mechanical-vs-judgment classification in §3 — score first, then dispatch
accordingly:

| Score | Dispatch |
|---|---|
| 1-3 | `claude-haiku-4-5-20251001`. |
| 4-7 | `claude-sonnet-5` as primary implementer; may optionally peel off strictly mechanical sub-pieces to `claude-haiku-4-5-20251001` subagents run alongside it. |
| 8-10 | The controller (Opus 5) is the primary implementer — no capped subagent owns a task this hard. It still uses the normal Haiku/Sonnet subagent scaling for any genuinely separable mechanical portions; leading the hard part directly doesn't mean going solo on all of it. |

Record the score on the task's ledger line (`score=<n>`) so a resumed run and any later review can
see why a task was dispatched where it was, without re-deriving the judgment call.

## Grading-level use (test-feature, kevin)

Neither skill computes its own complexity score — both reuse the **feature-level** score
`plan-feature` already wrote into the plan's `**Complexity:**` header line, so grading rigor tracks
design rigor without a second scoring pass.

| Plan complexity | Mode | Required session model |
|---|---|---|
| any | test-feature optimism 1-3; kevin `--plan`/`--domain` | Sonnet 5 |
| 8-10 | test-feature optimism 4-5 | Opus 5 |
| 4-7 (or no plan / no `**Complexity:**` line) | test-feature optimism 4-5 | Sonnet 5 |
| any | kevin `--e2e` | Sonnet 5 minimum; Opus 5 recommended past ~5 domains |

Same protocol as the feature-level gate: check the session's actual model against the required
tier before doing the substantive grading; if it falls short, tell the user and ask them to switch
(`/model`), waiting rather than proceeding by default. If they explicitly choose to proceed anyway,
note it in the report header, the same way `plan-feature` notes a below-tier design.

Neither skill dispatches subagents at any tier — this gate is purely about the interactive
session's own model, identical in spirit to the feature-level gate above.
