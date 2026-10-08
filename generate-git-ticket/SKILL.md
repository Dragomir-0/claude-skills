---
name: generate-git-ticket
description: >
  Turn a raw, pasted change or issue — English, Afrikaans, or a mix of the two — into a structured,
  platform-neutral markdown git issue body: pick a template with a flag (--basic default, --bug,
  --feature-request, or any file in templates/), run a short gap-filling questionnaire, pick
  Afrikaans or English output, and print the ticket in a code block. Writes no files.
  Triggered by /generate-git-ticket.
disable-model-invocation: false
allowed-tools: Read, Glob, AskUserQuestion
---

# generate-git-ticket

## Constraint — read this first

**This skill writes no files. Its only output is one fenced code block holding the ticket.** It
never creates the issue on a remote, never commits, and never edits source.

**Platform-neutral body only.** Tickets go to many git platforms, so the output is just the issue
body markdown. No labels, tags, assignees, milestones, front matter, or platform-specific syntax.

**Never spawn subagents.** Every step runs in the current session.

**Never invent facts.** Everything in the ticket comes from the paste or from the user's answers,
except where a template's `## Section rules` explicitly allows inference. Every section follows
those rules: it is left out or set to `TODO`, never filled with a plausible-sounding guess.

Usage: `/generate-git-ticket [--<template>] [raw change text]`

`<template>` is the name of a file in `templates/` without `.md`, matched case-insensitively.
The shipped ones are `basic` (the default), `bug`, and `feature-request`. To add a ticket type,
drop a new `templates/<name>.md` that follows the same contract. The skill doesn't change.

The rules for telegraphing before acting, cost discipline, and the no-subagent policy come from
`~/.claude/skills/_shared/pipeline-contract.md`. There is **no model floor**: this is a
transcription-and-translation task that any tier handles, so it adds no gate to
`_shared/complexity-scoring.md`.

## 0 — Select and load the template

- If the invocation's argument starts with a token beginning `--`, that token (minus the `--`) is
  the template name and everything after it is the paste. Otherwise the template is `basic` and
  the whole argument is the paste.
- Read `~/.claude/skills/generate-git-ticket/templates/<name>.md`, matching the name
  case-insensitively.
- Unknown name → Glob `~/.claude/skills/generate-git-ticket/templates/*.md`, list each name with
  its `Purpose:` line, and stop. Never fall back to another template silently.
- `basic.md` missing when no flag was given, or the `templates/` folder missing → say so and stop.
- Telegraph the template in use in one line.

The chosen file is the **only** definition of the ticket's structure, section rules,
questionnaire, and labels. Never rebuild them from memory, from another template, or from an
earlier run.

## 1 — Ingest the paste

The raw text is either the argument left over after §0 or, failing that, the user's next message.
If there's neither, ask for it in one line and wait.

The paste can be English, Afrikaans, or both, even within one sentence. Read it as a whole and map
what it says onto the template's fields, following its `## Section rules`. These hold for every
template:

- **Title**: a short, plain summary, at most about ten words. No issue number, because git numbers
  the issue itself.
- **The always-asked person field** (`Reported by`, `Requested by`, …): never filled from the
  paste. Note any names it mentions as candidates for §2.
- **Descriptive sections** (Description, Summary, …): what the paste says, with no guessed cause or
  invented solution.
- **Acceptance Criteria**, where the template has them: derive them from any expected behaviour the
  paste describes, for example "it should…" or "moet eintlik…".

**Keep verbatim, never translate:** error messages, log lines, identifiers, URLs, file paths,
product and system names, button and menu captions quoted from the UI, and code.

## 2 — Questionnaire — **HARD PAUSE**

Telegraph in one line, then ask using **one** `AskUserQuestion` call of at most 3 questions plus
the language question from §3. The questions come from the template's `## Questionnaire`, in its
order.

- **The always-asked person field is asked every run, even when the paste names someone.** Never
  assume it, and never look it up from git, the OS, or the session. Offer any names the paste
  mentions as options and pad with "Unknown" so there are at least two. The user types the real
  name through "Other".
- Every other question is asked only when its field is missing or genuinely unclear. For the
  system field, offer candidates the paste suggests. For criteria, offer "Leave out" and use
  "Other" for typing them.
- "Other" is always there for free text. If something else is ambiguous and outranks a listed
  question, for example a description that could mean two different behaviours, it may take the
  lowest slot.
- Never ask about something the paste already states.
- Never ask about a field the template's `## Questionnaire` doesn't list. Its rules decide it.
- §2 is never skipped, because the person field is always asked.

## 3 — Output language — **HARD PAUSE**

Ask: **Afrikaans** or **English**. Never infer the language from the paste. A mixed paste is the
normal case, not a hint.

Add this as the **last** question of §2's call so there's only one round trip.

## 4 — Compose

- Fill the template's `## Structure` block.
- Chosen language is Afrikaans → replace every label using the template's `## Labels`. `TODO`
  stays `TODO`.
- Translate all free text into the chosen language, except the verbatim items from §1. The
  finished ticket is in **one** language.
- Drop every section or line whose rule says "Leave the section out" or "Leave the line out" and
  that has no content. Drop its heading too.
- Keep the template's order and headings exactly. Add no sections it doesn't define.

## 5 — Output

Give a one-line lead-in, then the ticket in a single fenced `markdown` code block, and nothing
after it. If the ticket body itself contains triple backticks (a quoted log or code), use a
four-backtick outer fence so the block isn't cut short.

## Common mistakes

| Rationalization | Reality |
|---|---|
| "No flag, so it's probably a bug" | No flag means `basic`. Only `--bug` selects the bug template. |
| "The flag is close enough to a template name" | An unknown name lists the templates and stops. Never guess one. |
| "Adding labels or tags helps triage" | Output is a platform-neutral body only. No labels, tags, assignees, or front matter. |
| "The cause is obvious from the paste" | Descriptive sections hold behaviour only. A suspected cause goes in Investigation if the template has it, otherwise nowhere. |
| "I can sketch a likely fix" | Never invent a solution. Only include one the paste or user states, in a section the template defines. |
| "The error reads better translated" | Error strings, UI captions, and names stay verbatim so they can still be searched for. |
| "The reporter is obviously me / the git user / the name in the paste" | The template's person field is always asked. Never assume it and never look it up. |
| "Asking confirms it" | Asking about something the paste already states wastes the user's turn. |
| "I'll add ISSUE-### to the title" | Git numbers the issue. The title is just the title. |
| "I'll save it to a file for them" | This skill writes no files. The code block is the deliverable. |
| "Some terms are clearer in the other language" | Except for verbatim items, the ticket is in the chosen language only. |
| "I remember the format" | The selected template file is the format. Read it every run. |

## Next step

None in the pipeline. This skill is standalone. A `--feature-request` ticket, or any ticket that
describes work to build, can feed `/plan-feature` as a written description.
