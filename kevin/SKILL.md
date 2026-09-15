---
name: kevin
description: >
  Drive a live feature — or a whole map domain, or the entire project end-to-end — through its
  actual frontend as a careless first-time user, deliberately mistyping, misclicking and
  mishandling every step, and report every bug, crash, dead end and confusing moment encountered
  along the way. Reads a FEATURE_PLAN or the codebase map to know what's meant to do, never
  source. Triggered by /kevin.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Glob, Grep, Skill, AskUserQuestion, Artifact, Workflow
---

# kevin

## Constraint — read this first

**This skill writes exactly one report file per run — plus, in `--e2e` mode only, a regenerated
`ONBOARDING.md` — and publishes exactly one Artifact page: a plain-English writeup for the people
who'll use what was tested. It never edits source, and it never learns the feature from source.**

Kevin is a user, not a code reviewer. He only knows what the plan's acceptance criteria say the
feature should let him do — never the File Impact Manifest, never a diff, never an implementation
file. Reading source to "understand the feature better" is exactly the shortcut a real first-time
user doesn't have, and it's off-limits here for the same reason `test-feature` can't skip an
evaluation vector: it would produce evidence about a persona this skill isn't running.

Usage:
  `/kevin --plan <path to FEATURE_PLAN_<Name>.md> [--url <base-url>]` — single feature, plan-driven
  `/kevin --domain <name> [--url <base-url>]` — single map domain, no plan needed
  `/kevin --e2e [--url <base-url>]` — whole project, every domain plus a cross-domain journey

Artifact paths, `<Name>` derivation and repo resolution come from
`~/.claude/skills/_shared/pipeline-contract.md`.

## 0 — Gate

**Pick the mode from how kevin was invoked**, then jump to the matching lookup below. §1
(get the app running) and §2 (persona) apply to every mode; §3–§5 are the single-feature/domain
report format, replaced by §6 for `--e2e`.

| Invocation | Lookup |
|---|---|
| `--plan <path>`, a named feature, or bare `/kevin` | **Locate the plan**, below |
| `--domain <name>` | **Map lookup**, below |
| `--e2e` | Skip both lookups — go straight to §6 |

### Locate the plan

- In order:
  1. An explicit `--plan` argument.
  2. If the invocation names a specific feature, search `.claude/plans/FEATURE_PLAN_*.md` (the
     container too, in a workspace) for a plan matching it — by title or filename, not necessarily
     an exact string match ("test the tag scan feature" should find a plan named `patrol-scan-*`,
     not only one literally titled "tag scan"). More than one plausible match → ask which one,
     listing the candidates.
  3. A feature was named but no plan matches it → run the **Map lookup** below instead of asking
     — same as `--domain` would, matched against the named feature. Note in the report that no
     formal plan existed and this ran from the map instead.
  4. No feature was named at all (a bare `/kevin`) → the newest `.claude/plans/FEATURE_PLAN_*.md`
     (container too, in a workspace), as before.
  5. Still nothing usable → ask.
- **Read only what a user brief would contain:** the title, the acceptance criteria, and the
  selected tier's milestones, described functionally. **Do not open the File Impact Manifest, any
  file it lists, or the diff.** Stop reading once you have the functional description — don't keep
  scanning into the manifest "while you're there."
- If the plan names more than one repo, the frontend-facing repo is the one in scope. Say which
  one and why.

### Map lookup (`--domain <name>`, or a named feature with no matching plan)

- Read `.claude/maps/index.md` (the container too, in a workspace) and match `<name>` against the
  domain table — by domain name first, then by what a flow's title or purpose describes, the same
  loose match **Locate the plan** uses for a feature name. More than one plausible match → ask,
  listing the candidates. No match at all → list the domains the index actually has and ask.
- Read only that domain's `.claude/maps/<domain>.md` — the `## Flow:` purpose, in/out and call
  order **as a description of what the feature does**, never as a set of files to open. This is
  the same altitude a plan's acceptance criteria would give Kevin; the map's `## Structure` and
  file paths are exactly the shortcut §2 already forbids taking from a plan's manifest.
- A domain lists more than one `## Flow:` — test all of them unless `<name>` clearly named one
  specific flow, in which case test only that one. Each flow gets its own Coverage/Issues entry in
  §4, same file.
- `<Name>` for the report and announcement is the domain's own kebab-case name (already
  kebab-case per `map-codebase`'s domain-naming convention) unless a matched feature name gives a
  more specific one.

## 1 — Get the app running

Invoke the `run` skill to launch, or confirm, the app. If it needs a base URL you don't have,
**hard pause** and ask rather than guessing a port.

Invoke the `claude-in-chrome` skill before touching any `mcp__claude-in-chrome__*` tool — it
gates on site permissions that need to be set up first.

**Test data only.** Never submit to a real payment processor, a real outbound email/SMS
recipient, or anything that notifies a real third party. If the flow requires one of these, ask
for a safe target (sandbox mode, a test card, an address you control) before proceeding.

**Native mobile frontend (nothing `claude-in-chrome` can reach).** Before writing that ground off
as unreachable, check for a connected device: `adb devices` (Android SDK platform-tools; if `adb`
isn't on `PATH`, it's usually under the SDK's `platform-tools/` — locate it once, then prepend it
for the rest of the run). A connected, authorized device — physical or emulator — turns the mobile
frontend from unreachable into drivable, the same way a running dev server does for a web app:

- Launch / kill: `adb shell am start -n <package>/<activity>`,
  `adb shell am force-stop <package>` (`adb shell cmd package resolve-activity --brief <package>`
  finds the launcher activity if you don't already know it).
- Act: `adb shell input tap <x> <y>`, `adb shell input text "..."`, `adb shell input keyevent
  KEYCODE_BACK` (and other `KEYCODE_*` as needed).
- Look: `adb exec-out screencap -p > file.png`, then read the PNG — there's no accessibility-tree
  snapshot like `take_snapshot`, so screenshot before *and* after each action rather than guessing
  coordinates blind. `adb shell uiautomator dump` gives an XML layout dump when a screenshot alone
  doesn't pin down where to tap.
- Toggle device state the feature depends on: `adb shell svc nfc enable|disable`, `adb shell svc
  wifi enable|disable`, `adb shell svc data enable|disable`, etc.
- Same rules as §2 apply here too: mistake-then-correct passes, and never fake a physical action a
  real user can't skip — a real NFC/QR scan needs a real tag against real hardware; don't call the
  scan endpoint directly to simulate one, and don't treat a `uiautomator`/`adb shell input` route
  around a stuck screen as anything but a finding. The same real-third-party-notification rule
  applies too — a live Panic/SOS-style control is exactly as off-limits here as a real payment or
  email field on the web.
- No device connected, or the installed build obviously doesn't match the plan under test (wrong
  version, wrong branch) → mark that ground unreachable as before. Don't build, install, or side-
  load anything, and don't stand up an emulator yourself unless asked — note in the report what a
  device/build would need to be to close the gap.

## 2 — The Kevin persona

Kevin knows *what* the feature is for — the plan told him that much, the way a colleague might
say "there's a new way to export invoices now." He's **never used this UI before** and treats
every screen as unfamiliar. He isn't stupid, just careless and impatient: he skims labels, trusts
his first guess over reading instructions, and would rather try something than read a tooltip.

**At every step of the flow, do it wrong at least once before doing it correctly.** Pick whichever
of these fits the step, vary it across the run, then also do the correct version so the flow can
continue:

- Submit the step empty, or with only some fields filled.
- Enter the wrong kind of input for a field (letters in a number field, a past date where a
  future one is required, an over-long string, emoji, leading/trailing whitespace).
- Double-click submit, or submit twice in two tabs.
- Navigate away mid-flow (browser back, close a modal, refresh) and come back.
- Upload or paste the wrong kind of thing where a specific format is expected.
- Ignore an inline validation hint and submit anyway.
- Resize to a mobile viewport partway through, or zoom in heavily.
- Click a control that looks disabled, or looks like it does something else.

Skip the mistake pass on a step only when no plausible mistake exists (a step with no input to get
wrong) — never skip because the correct-only pass is faster.

**Interact only through the rendered page** — clicks, typing, keyboard, scroll — exactly what a
mouse-and-keyboard user could do. Never call an API directly, edit `localStorage`/cookies/network
requests to force a state, or open devtools to route around a stuck UI. If Kevin would be stuck, a
real user would be stuck too — that's a finding, not an obstacle to work around.

**On the correct-usage pass, capture one screenshot per major step.** These feed the how-to steps
in §5 (or §6.5's onboarding doc, in `--e2e` mode) — take them once the screen is in the clean, expected state (no validation errors, no
half-filled fields), and reuse the same screenshots from the plan's happy path if a step also gets
one in the Issues section.

**Diagnostics Kevin can't see are still evidence, never a shortcut.** Console errors and failed
network requests are fair to record alongside a symptom Kevin *did* notice on-screen — they
explain *why* the button did nothing. Never use them to figure out *how* to operate the feature.

| Temptation under time pressure | Reality |
|---|---|
| "Let me check the component for the right field name" | That's the shortcut a real user doesn't have. Guess from the label, like Kevin would. |
| "Happy path first to save time, mistakes after" | Order doesn't matter, but skipping the mistake pass on a step does — cover it before moving on. |
| "This step obviously has no wrong way to do it" | Try anyway once — empty submit, double-click, back button. Only skip after actually trying. |
| "It's clearly a network issue, not worth a full repro" | Record it with repro steps anyway — `/execute-plan` needs steps, not a guess at the cause. |

## 3 — Coverage (`--plan` and `--domain` modes)

Work through every acceptance criterion and milestone in the plan's selected tier (or, in
`--domain` mode, every `## Flow:` read in §0's Map lookup), applying the persona in §2 to each.
Note in the report whether it was exercised, partially exercised (the flow broke before reaching
it), or unreachable.

## 3b — UI/UX rating (`--plan` and `--domain` modes)

Rate what was actually experienced — don't re-run the flow for this, score what §2/§3 already
surfaced.

**Persona score (1–5).** How much friction a careless first-time user actually hit: 5 is
frictionless and intuitive, 1 is confusing throughout. Base it on the density and severity of
Confusing/Critical findings from §3, not a fresh judgment call — one line naming what drove the
score.

**Expert critique.** Invoke the `ui-ux-pro-max` skill (`Skill` tool) against the *clean* screenshots
captured in §2's correct-usage pass — never a mistake/error-state capture, those show the app
mid-fault, not its design. Ask it to assess visual design and accessibility (contrast, spacing,
tap targets, labeling), and — **only when the plan being tested carries a `## Design Direction`**
— whether the live UI actually matches it (style, palette, typography, component patterns). In
`--domain` mode, or a `--plan` run whose plan has no Design Direction, mark that check "n/a — no
Design Direction to check against" rather than inventing one to compare.

**Correction Plan entries.** A concrete violation from the expert critique — fails a stated
accessibility guideline, contradicts the plan's Design Direction — gets its own `[UI/UX]`-tagged
entry in §4's Correction Plan. A subjective style preference with no concrete violation behind it
stays in this section only; it does not become a Correction Plan entry.

## 4 — Output (`--plan` and `--domain` modes)

Write `.claude/reports/KEVIN_REPORT_<Name>.md`:

```markdown
# Kevin Report — <Name>
Plan: <path, or "none — sourced from map files (<paths>)" per §0's Map lookup>   URL: <base-url>   Generated: <ISO date>

## Verdict
<one line: usable / confusing in places / broken>

## Coverage
<checklist of acceptance criteria / milestones — exercised / partial / unreachable, and why>

## Issues
1. **[Critical|Confusing|Minor]** <title>
   - Steps: <numbered, first-person, exactly what Kevin clicked/typed>
   - Expected: <what a first-time user would reasonably expect>
   - Actual: <what happened, plus any console/network evidence>
   - Screenshot: <path/description, if captured>

## UI/UX Rating
**Persona score:** <1-5> — <one-line rationale, drawn from Issues above>
**Expert critique (ui-ux-pro-max):**
  - Visual design: <notes>
  - Accessibility: <notes>
  - Consistency with Design Direction: <match / mismatch, with specifics — or "n/a — no Design Direction to check against">
**Overall:** <1-5>

## Correction Plan
1. [repo] <atomic fix — area if inferable from the symptom, what, why>
2. [repo] [UI/UX] <atomic fix, from a concrete expert-critique violation only>
3. ...
```

Severity: **Critical** blocks completing the flow at all. **Confusing** lets Kevin finish, but
only after real friction — a wrong error message, a dead end with no way back, a control that does
the opposite of what it looks like. **Minor** is cosmetic, a small papercut.

The **Correction Plan** mirrors `test-feature`'s — numbered, atomic, each naming the repo in a
workspace — but drawn from usability symptoms observed through the UI, not from a diff. Where the
underlying cause isn't visible from the frontend, say so and describe the symptom precisely enough
for a developer to locate it.

For a cross-repo feature, the report goes to `<container>/.claude/reports/KEVIN_REPORT_<Name>.md`.

## 5 — Feature announcement (`--plan` and `--domain` modes only — `--e2e` uses §6.5 instead)

Once the report is written, publish a second, separate deliverable: a plain-English page telling
end users what the feature is and how to use it. This is for the people who'll click the button,
not the developer reading the Correction Plan — a different audience from the report in §4.

- **Source it from the same functional description read in §0** — the plan's title and acceptance
  criteria — never from the report's issues, the diff, or the File Impact Manifest.
- **Never mention this skill's name, that a persona or UAT pass ran, bugs found, screenshots,
  severities, or anything about testing, QA, or the pipeline.** Write it the way a product team
  would write a help page or release note: what's new, then how to use it as numbered, everyday
  steps — no internal jargon, no code, no file paths.
- Load the `artifact-design` skill before drafting the page, then write the HTML to a temp file
  (the scratchpad directory) and publish it with the `Artifact` tool. Give it a title naming the
  feature (never this skill's name) and a one-sentence `description`.
- **Illustrate each how-to step with its clean screenshot from §2**, never a mistake/error-state
  capture. The published page can't load images from local disk or the Chrome session — base64-
  encode each PNG and inline it as a `data:image/png;base64,...` `<img>` next to its step. Skip a
  step's image only if no clean screenshot exists for it; never substitute an error-state one.
- Report the published URL in the terminal alongside the report's path — it isn't written into the
  report file, and it isn't one of the pipeline's `.claude/` artifacts.

**Model.** Once the grading in §1–§4 is done, drafting this page and publishing it is a
formatting/writing task over already-decided inputs (title, acceptance criteria, the clean
screenshots), not a judgment call about the feature itself. Dispatch it — loading
`artifact-design`, writing the HTML, and calling the `Artifact` tool — to a subagent pinned to
`claude-haiku-4-5-20251001` via the `Workflow` tool. Always specify the model explicitly; an
omitted model inherits the session's own. Hand its brief the plan's title/acceptance criteria, the
base64-encoded screenshots per step, and the rules above (audience, voice, what never to mention).
It reports back the published URL for you to print alongside the report's path.

## 6 — End-to-end mode (`--e2e`)

Replaces §3–§5 for this invocation. §1 (get the app running) and §2 (persona) still apply,
applied per-flow below.

### 6.1 — Cost checkpoint (every run, before touching the app)

- Read `.claude/maps/index.md` (container-level in a workspace) and count the domains and the
  flows listed under each.
- State that count out loud, and that a full-persona pass (§2's mistake-then-correct pattern, per
  step) across every one of them is a large, multi-domain spend — the same escalation checkpoint
  `pipeline-contract.md`'s cost-discipline section requires before any multi-x jump.
- **Ask before proceeding.** This runs every time, regardless of how few domains the map has —
  `--e2e` *is* the multi-x jump that checkpoint exists for, not a case that might be small enough
  to skip it.
- Declined, or scoped down to specific areas → switch to `--domain` for the area(s) named instead
  of running a partial `--e2e`.

### 6.2 — Per-domain coverage

Apply §2's persona to every `## Flow:` in every domain the index lists — same mistake-then-correct
pattern per step as single-feature mode, same exercised/partial/unreachable tracking as §3. Rate
each domain with §3b's UI/UX rating too — persona score plus the `ui-ux-pro-max` expert critique
against that domain's clean screenshots. `--e2e` has no single plan behind any one domain, so the
Design Direction check is always "n/a" here — never invented.

### 6.3 — Cross-domain journey

Run `map.mjs edges` for candidate couplings between domains (shared auth, a sequential business
process, shared queue/topic or route names). **Confirm a candidate is real before building a
journey on it** — per `pipeline-contract.md`, edges are candidates, not conclusions, and the same
string can appear in two domains by coincidence. Pick at least one confirmed edge that a real
user's session would actually cross, drive it start to finish through the UI, and apply §2's
persona at each step exactly as any other flow. A candidate that doesn't hold up gets said so in
the report, not a journey built on it anyway.

### 6.4 — Report

Write one consolidated report: `.claude/reports/KEVIN_REPORT_e2e-<ISO date>.md` (container-level
for a workspace) — a new dated file every run; past runs stay on disk.

```markdown
# Kevin E2E Report
URL: <base-url>   Generated: <ISO date>

## Verdict
<one line: usable / confusing in places / broken>

## Domains
### <domain>
<same Coverage + Issues structure as §3/§4, scoped to this domain>
<same UI/UX Rating structure as §4, Design Direction line fixed to "n/a — e2e mode">

### <domain>
...

## Cross-domain journey: <name>
<same Coverage + Issues structure, for the chained journey — or "none confirmed" and why>

## Correction Plan
1. [repo] [domain] <atomic fix — area if inferable, what, why>
2. [repo] [domain] [UI/UX] <atomic fix, from a concrete expert-critique violation only>
3. ...
```

Severity definitions (Critical/Confusing/Minor) are unchanged from §4.

### 6.5 — Onboarding doc (replaces §5 for this mode)

`--e2e`'s audience deliverable is a living guide, not a one-off announcement — refreshed every run
rather than published once per feature.

- **Regenerate `<repo-or-container-root>/ONBOARDING.md`** — repo root for a single repo, the
  container root for a workspace. Unlike every other pipeline artifact, **this file is not
  gitignored**: it is meant to be checked in and read by people, not tooling.
- Source it the way §5 sources its announcement: each domain's map functional description (title,
  flows, purpose) — never the Issues section, the Correction Plan, or source files.
- One section per domain (what it does, how to use it, numbered everyday steps), plus a short
  section for the cross-domain journey. No internal jargon, no mention of testing, QA, kevin,
  screenshots-as-evidence, severities, or file paths — same voice as §5's announcement.
- **Illustrate with clean screenshots** the same way §5 does: inline as base64
  `data:image/png;base64,...`, one per major step, skipped only where no clean screenshot exists —
  never substitute an error-state one.
- **Publish/republish it as an Artifact, reusing the same URL every run:**
  - First run: publish it, then write the URL into a hidden HTML comment at the very top of the
    file: `<!-- kevin-e2e-artifact: <url> -->`.
  - Every later run: read that comment before publishing, pass its URL to the Artifact tool so the
    same page updates in place, and leave the comment as-is unless the URL genuinely changed.
  - Publishing fails or is unavailable → say so, leave the comment untouched, keep the file on
    disk. The file is the deliverable; the Artifact is a convenience, same as `map-codebase`'s
    maps.

**Model.** Same reasoning and dispatch as §5's Model note: the domain grading is done by this
point, so drafting/regenerating `ONBOARDING.md` and publishing it goes to a `claude-haiku-4-5-20251001`
subagent via `Workflow`, given each domain's map functional description, the screenshots, the
existing artifact-comment URL (if any), and the voice/content rules above. It performs the
read-before-republish itself in the same dispatch and reports back the URL and whether the comment
needs updating.

## Common mistakes

- Reading the File Impact Manifest, a listed file, or the diff "just to understand the feature."
- Skipping the deliberate-mistake pass on a step because the happy path is faster to run through.
- Editing `localStorage`, cookies, or calling an API directly to get past a stuck screen.
- Reporting "broken" with no reproduction steps a developer could actually replay.
- Submitting real payment, email, or SMS targets instead of asking for a safe one first.
- Declaring full coverage when a step was actually unreachable — mark it unreachable, don't skip
  it silently.
- Running one correct-usage-only pass and calling it done — the mistake pass is the point.
- Naming this skill, the report, or testing/QA/bugs anywhere in the published feature announcement.
- Skipping the feature announcement, or drawing its content from the Issues/Correction Plan instead
  of the plan's acceptance criteria.
- Declaring a native mobile frontend unreachable without first checking `adb devices` for a
  connected handset or emulator.
- Reading a `--domain` map's `## Structure` paths as files to open — same shortcut §2 forbids for
  a plan's manifest, just from a different document.
- Skipping the §6.1 cost checkpoint because the map only has a handful of domains — it runs every
  time, not past some threshold.
- Building a §6.3 cross-domain journey on an edge that turns out coincidental, without confirming
  it first.
- Writing `ONBOARDING.md` from the Issues section or Correction Plan instead of each domain's
  functional description.
- Publishing a fresh Artifact URL for `ONBOARDING.md` every run instead of reading the existing
  `kevin-e2e-artifact` comment back and republishing in place.
- Adding `ONBOARDING.md` to `.gitignore` — every other pipeline artifact is ignored; this one is
  deliberately not.
- Running the ui-ux-pro-max expert critique against a mistake/error-state screenshot instead of a
  clean one — it would be critiquing a fault state, not the design.
- Inventing a Design Direction comparison when the plan has none, or in `--domain`/`--e2e` mode
  where there's no plan at all — mark it "n/a," don't guess one up.
- Letting a subjective style preference from the expert critique become a Correction Plan entry —
  only a concrete violation (accessibility guideline, Design Direction mismatch) earns one.

## Next step

If the Correction Plan is non-empty, `/execute-plan` consumes it — from any mode, including
`--domain` and `--e2e`. Name it; do not invoke it.
