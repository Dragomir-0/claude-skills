---
name: plan-feature
description: >
  Turn an Azure DevOps ticket or a written description into a three-tier implementation plan
  with File Impact Manifests, scored effort, milestones and hard pauses. Reads the architecture
  maps; writes only the plan file, never source. Triggered by /plan-feature.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion, EnterPlanMode, ExitPlanMode, Skill
---

# plan-feature

## Constraint — read this first

**This skill writes exactly one file: the plan. It never modifies source code.**

If asked mid-run to "just make the change while you're in there", refuse and point at
`/execute-plan`. The value of a plan is that it was written before anyone touched anything; a
planner that edits code produces neither a plan nor a reviewed change.

Artifact paths, repo resolution, `<Name>` derivation and cost discipline come from
`~/.claude/skills/_shared/pipeline-contract.md`. The complexity rubric used below comes from
`~/.claude/skills/_shared/complexity-scoring.md`.

## 1 — Ingestion

Accept **either** an ADO work item or a written description.

**Default to asking.** Everywhere below that says "ask" is a floor, not a ceiling — if anything
about scope, intent, acceptance criteria, constraints, or tradeoffs between approaches is genuinely
open, ask about it rather than picking a reasonable-looking default. A plan built on a silent
assumption is wrong in a way that's expensive to discover later; a clarifying question costs a
few seconds. When in doubt, ask one more question than feels strictly necessary.

### Feature classification (ask first)

Before touching ADO or a description, ask via `AskUserQuestion`: is this a **standalone
feature** or a **roadmap item** (one piece of a larger, multi-feature initiative)? **Hard
pause** — wait for the answer.

If the answer is roadmap item, ask a second `AskUserQuestion`: is it an **active** item (in
scope now) or a **future** item (planned, not yet being built)? **Hard pause** — wait for the
answer.

Carry both answers through the rest of this skill:

- Recorded in the plan header (Section 6) as a **Classification:** line.
- A roadmap item is also registered in `.claude/roadmap.md` — see the pipeline contract's
  artifact table and Section 6's Roadmap register.
- A **future** roadmap item changes how Sections 4 and 5 read — see the callouts there.

### From Azure DevOps (`--ado <id>`)

Reuse the existing read-only helper. Do not write new ADO code.

```bash
powershell -File ~/.claude/skills/ado-status/ado.ps1 workitem -Id <id>
```

It needs `AZURE_DEVOPS_ORG_URL` and `AZURE_DEVOPS_PAT`. Confirm both are set; **never print the
PAT**. If either is missing or auth fails, tell the user to run `/ado-status` first to validate
the connection, and stop.

Extract and strip HTML to plain text:

- `System.Title`
- `System.Description`
- `Microsoft.VSTS.Common.AcceptanceCriteria`
- `Microsoft.VSTS.TCM.ReproSteps`
- the comment / discussion thread

All requests are GET-only, the same contract as `ado-status`. This skill never writes to ADO.

If no ID was given, list the user's open items for the current sprint using the same WIQL query
as `ado-status`, print each as `#<ID>  <Title>  [<State>]`, and ask which to plan. **Hard
pause** — do not proceed until answered.

**Empty-ticket rule.** If title, description, acceptance criteria and repro steps are *all*
empty, do not proceed on the title alone. Tell the user the ticket carries no written spec and
ask them to confirm the intended scope or supply detail. Wait for the answer — **a guessed task
poisons every downstream stage.**

### From a description (`--description "..."`)

Use the text as given. If it is a single vague sentence, ask the clarifying questions that
change the design before planning against a guess — and don't stop at the first one that resolves
the biggest ambiguity if smaller ones remain.

### Complexity score & model gate

Once the request is unambiguous — the empty-ticket rule and the vague-description rule above are
satisfied, not worked around — score it using the feature-level rubric in
`~/.claude/skills/_shared/complexity-scoring.md`. Show the breakdown before moving to map
contextualisation.

The score fixes which model this design must run under. `plan-feature` never dispatches
subagents at any score — this gate is purely about the interactive session's own model. Look the
required tier up deterministically rather than re-reading the table by eye:

```bash
node ~/.claude/skills/tooling/cli.mjs complexity-scoring.modelForGate '["featureLevel", <score>]'
```

Returns `{"model": "sonnet5" | "opus5", "note": "no subagents"}` (1-7 → Sonnet 5, 8-10 → Opus 5).
Check the required tier against the model actually powering this session (stated in your own
system prompt). If the session already meets or exceeds it, continue. If not, tell the user the
score and that this design needs to run on the required model — ask them to switch (`/model`)
before you continue, and wait; don't proceed on a lower tier "just this once." If they explicitly
choose to proceed anyway, note in the plan's header that it was designed below the required tier,
so `/execute-plan` and any later reviewer can see it.

## 2 — Map contextualisation

**Call `EnterPlanMode` before anything else in this step.** `plan-feature` always designs under
plan mode — the exploration below and the three-tier design in step 3 are exactly the
"explore, then design an approach for approval" work plan mode exists for, and `/execute-plan`'s
own gate already assumes it was used (it refuses to run while plan mode is still active,
un-approved). If the user declines to enter plan mode, stop and explain that this pipeline stage
depends on it rather than continuing without it.

Read `.claude/maps/index.md` and the domain maps relevant to the feature. Extract the specific
flows the feature touches so you understand how the system behaves today, start to finish.

**Read the repo's own docs too.** `map.mjs scan` reports them as `projectDocs`, agent-directed
files first. A repo that documents itself is the authority on its own architecture — where a doc
disagrees with a map or with what directory names suggest, **the doc wins**. Planning against an
inferred architecture produces manifests that name files which do not do what you assumed.

**If no maps exist**, say so and offer to run `/map-codebase` first. Do **not** silently fall
back to scanning source — that is precisely the expensive rediscovery the maps exist to prevent.
If the user declines mapping, proceed under the cost discipline in the contract and say the plan
is built on a partial view.

### Cross-repo features

Run `map.mjs workspace`. If it exits 0, the target is a **workspace** — several repos forming one
product — and this feature may span more than one of them.

1. Read `<container>/.claude/maps/WORKSPACE_MAP.md` for the cross-repo edges, shared contracts,
   and change guidance.
2. Decide which repos the feature touches. Say so explicitly and early; it changes everything
   downstream.
3. **A change that crosses a shared contract is a multi-repo change.** Generated clients, shared
   DTOs, queue message shapes and API route names all fall in this class — a contract edit on one
   side is incomplete until the other side is updated. The workspace map records the regeneration
   or update command under `## Build & test commands` — the one section the read-only guardrail
   carves out for commands. Put it in the plan as a task, not a footnote. If that section is
   absent, ask the user for the command rather than inventing one.

If it exits 4, the target is a single repo. Everything below behaves exactly as before.

## 2b — Design direction

Skip this step entirely for a feature with no user-facing UI surface — a pure API, data,
background-job, or infra change. Judge this from the feature description and the map's stack
info (Section 2): if the affected repo(s) carry a frontend stack (React, Vue, Blazor, WPF,
SwiftUI, etc.) and the feature adds or changes a screen, page, view, or component, it's
UI-touching.

For a UI-touching feature, invoke the `ui-ux-pro-max` skill (`Skill` tool) with the feature's
description, target stack, and any existing style/brand constraints from the repo's docs. Ask it
for a **Design Direction**, not a mockup: the style, color palette, typography, and key component
patterns this feature should follow, in a short paragraph plus a bullet list — a few sentences,
not a full spec. This keeps Tier 1 and Tier 2 (Section 3) building against the same visual
direction instead of each tier improvising separately.

Record the result in the plan as `## Design Direction`, placed after the header lines and before
Tier 1. Omit the heading entirely for a non-UI feature — its absence tells `/execute-plan` there's
nothing to carry into task briefs.

## 3 — Three-tier design engine

Produce exactly three tiers.

| Tier | Depth | Content |
|---|---|---|
| **1 — Status Quo** | Full | Implement using the architectural standards and patterns already present in the project. Do not optimize. Do not refactor. The only permitted additions are mandatory vulnerability and security checks. |
| **2 — Localized Optimization** | Full | Builds on tier 1, optimising **only** the files this feature flow touches. Mandate best practices and computationally efficient data retrieval and processing. Require unit tests written specifically to prove the efficiency claim. If a required optimisation breaks standard operating bounds, state the roadblock plainly and ask for explicit approval before assuming it. |
| **3 — Global Upgrade** | **Sketch** | Prose summary only: what an unbounded rewrite would change — dependency upgrades, surrounding refactors, paradigm shifts — and why it might be worth it. Give an affected-area summary, not a file list. Expand to full depth only if the user asks. |

### File Impact Manifest

Tiers 1 and 2 each carry an **exhaustive** list of every file created, modified, or deleted, one
line of reasoning per file. **The Repo column is mandatory** — single-repo plans repeat one value,
which costs nothing and means `/execute-plan` never has to guess:

```
| Repo | Action | File | Why |
|---|---|---|---|
| api | Create | `src/Api/Services/BarcodeImportService.cs` | Owns the parse-and-persist flow |
| api | Modify | `src/Api/Controllers/AssetController.cs` | New POST endpoint |
| web | Regenerate | `src/app/openapi-generated/` | Contract changed; run the workspace map's command |
```

Paths are **repo-relative**, with the repo named in its own column — never a container-relative
path glued onto the front.

Tier 3 gets an affected-area summary instead, naming the repos involved.

### Scoring

This is separate from the feature-level complexity score computed at ingestion — that one sized
the *design* work; this one sizes *implementation* per tier, now that tiers exist.

Score every tier on all of these:

- **Complexity:** 1–5.
- **Estimated files created/modified:** a count plus representative paths.
- **Estimated token effort** — Claude Code's execution effort, **never the user's wall-clock
  time**. Pick a band, then give a point figure inside it:
  - **S (~5–15k):** 1–2 files, a localized edit following an existing pattern, minimal new tests.
  - **M (~15–40k):** 3–6 files or one new component, some cross-file wiring, a handful of tests.
  - **L (~40–100k):** 7+ files or a new subsystem, cross-cutting changes, broad test coverage.
  - **XL (>100k):** architectural change or migration — flag it for a follow-up split.
  The band makes two tiers comparable; the figure is your best guess inside it.
- **Risks and unknowns.**
- **Reusable existing utilities** to lean on, with their file paths.

## 4 — Milestones and hard pauses

Every tier decomposes into sequential milestones. Each milestone is a **functional, testable
increment** — not "write the model layer", but "the endpoint accepts a barcode and returns 202".

**Each milestone names the repos it touches.** A milestone spanning repos must also state its
**deployment ordering constraint**, because the two sides ship separately:

- *Adding* a contract — backend first; the frontend is harmless until it calls the new thing.
- *Removing or renaming* one — consumer first; the producer cannot drop it while callers remain.
- *Changing a shape in place* — usually needs a compatible intermediate step. Say so rather than
  pretending a simultaneous deploy is possible.

Prefer milestones that leave every repo independently deployable at the boundary. Where that is
impossible, say it plainly — an honest "these two must ship together" is worth more than a
milestone split that pretends otherwise.

End every milestone in the plan with this directive, addressed to the future implementing
session:

> **HARD STOP.** Do not begin the next milestone. Ask the user to test the feature up to this
> point and wait for explicit approval before continuing.

**Future roadmap items skip the per-milestone HARD STOP.** The plan still needs testable
milestones — a future item will eventually be executed — but pausing to ask for approval makes
no sense on work nobody is running yet. Drop the blockquote above for a future item and place a
single note in Contingency (Section 5) instead.

## 5 — Contingency

Close the plan with:

- **Consolidated risks** for the selected tier.
- **Fallback approaches**, drawn from the tiers not chosen, to fall back to if the primary
  approach hits a blocker mid-execution.
- **Validation gate** to run before the work is considered done: branch pseudo-build → runtime
  tests → `/code-review` → `/test-feature`. Proceed to merge only if all are clean.
- **Future roadmap items** get a **Design checkpoint** note here instead of the milestones'
  HARD STOPs: state plainly that this plan is forward design, not scheduled work, and that
  `/execute-plan` must not run against it until the item is reclassified active and a human has
  re-confirmed the plan still matches the current codebase — maps and code may have moved on.

## 6 — Output

**Single-repo feature** → `<repo>/.claude/plans/FEATURE_PLAN_<Name>.md`.
**Cross-repo feature** → `<container>/.claude/plans/FEATURE_PLAN_<Name>.md`, and state the repo
list in a `**Repos:**` line directly under the title so `/execute-plan` can read it without
parsing the manifest.

State the ingestion complexity score in a `**Complexity:**` line directly under the title, e.g.
`**Complexity:** 8/10 (High) — designed under Sonnet 5 (user chose to proceed below the required Opus tier)`.

State the feature classification in a `**Classification:**` line directly under the title:
`Standalone`, `Roadmap (active)`, or `Roadmap (future)`.

Include the ADO work item ID and title when there is one.

Present the three tiers in a compact comparison, recommend the best-value tier first, then use
`AskUserQuestion` to let the user choose. This happens **inside plan mode**, alongside the usual
exploration and design work — it's the "clarify approaches" use of `AskUserQuestion` plan mode
expects, not a substitute for the approval step below. Record the choice by appending ` (chosen)`
to that tier's own `## Tier <N>` heading — e.g. `## Tier 2 — Localized Optimization (chosen)` —
the literal, parseable marker `/execute-plan` reads to know which tier's milestones to execute, and
`/cleanup-crew`'s plan-pruning step (`tooling/lib/plan-pruning.mjs`) reads back later to know which
milestones a finished plan needs `APPROVED` lines for before it's safe to delete. Nothing else in
the plan marks the choice — don't also write a separate "chosen tier" line elsewhere.

### Approval and write

Once a tier is chosen, write out its full content — manifest, milestones, contingency, the
required headings below — and call `ExitPlanMode` to request the user's approval, per plan mode's
own rules. If they approve, write the canonical artifact to the path above. If they come back with
changes, revise within plan mode and call `ExitPlanMode` again — don't write the artifact until an
`ExitPlanMode` round is actually approved. This is what leaves plan mode inactive by the time
`/execute-plan` runs, satisfying its gate.

### Roadmap register

If the feature was classified as a roadmap item, after the artifact is written, append or
update its row in `.claude/roadmap.md` (path and shape defined in the pipeline contract) with
its `<Name>`, title, status (`Active`/`Future`), and the plan's path. Update the existing row
for a `<Name>` already present rather than duplicating it — a replan that moves an item from
Future to Active is a status update, not a new entry.

Required headings, because `/execute-plan` parses them (`## Design Direction` only when Section
2b actually ran — its absence is meaningful, not an omission):

```
## Design Direction
## Tier 1 — Status Quo
### File Impact Manifest
### Milestones
## Tier 2 — Localized Optimization
### File Impact Manifest
### Milestones
## Tier 3 — Global Upgrade (sketch)
## Contingency
```

## Common mistakes

- Editing source "while you're in there". This skill plans; `/execute-plan` builds.
- Proceeding on a ticket title when the ticket has no written spec.
- Scoring the ingestion complexity before resolving ambiguity, instead of after.
- Proceeding on a lower-tier model at High complexity because the current model "seems fine" —
  ask the user to switch, don't decide it's unnecessary yourself.
- Skipping `EnterPlanMode`, or designing outside it, because the request "seems simple enough".
- Writing the `FEATURE_PLAN_<Name>.md` artifact before an `ExitPlanMode` round was approved.
- Settling for the first plausible reading of an ambiguous request instead of asking — see the
  ingestion principle above.
- Scanning source because the maps were missing, instead of offering `/map-codebase`.
- Quoting the user's wall-clock time instead of Claude Code's execution effort.
- A File Impact Manifest that says "and related files" — it must be exhaustive.
- Milestones that are layers rather than testable increments.
- Expanding tier 3 to full depth unasked.
- Writing to ADO. Ingestion is GET-only.
- **Planning a contract change in one repo and forgetting the consumer.** If the change crosses a
  generated client, shared DTO, queue message shape or route name, the other repo is in scope.
- **Omitting the Repo column** because the feature "is obviously all in one repo".
- Asserting a simultaneous deploy when the repos ship separately.
- Trusting a map over the repo's own `CLAUDE.md` / `ONBOARDING.md`.
- Skipping the standalone-vs-roadmap classification question because the request "obviously"
  is one or the other.
- Keeping the per-milestone HARD STOP on a future roadmap item instead of the single Design
  checkpoint note.
- Writing a roadmap item's plan without registering it in `.claude/roadmap.md`.
- Running the design step (2b) on a backend-only feature with no UI surface.
- Skipping the design step on a feature that adds or changes UI, then letting Tier 1 and Tier 2
  each invent their own look.
- Asking `ui-ux-pro-max` for a full mockup instead of a compact Design Direction — it's meant to
  fit in a paragraph plus bullets, not become its own deliverable.

## Next step

`/execute-plan` implements the selected tier. Name it; do not invoke it.
