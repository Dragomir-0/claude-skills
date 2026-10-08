# Bug ticket template

Purpose: Defect report — observed behaviour, reproduction steps, expected vs actual, impact, workaround, and investigation so far.

Read by `generate-git-ticket` when it is invoked with `--bug`. This file is the **only** place
this ticket's structure is defined, so you change the format here and not in the skill. The skill
fills the `## Structure` block, asks what `## Questionnaire` allows, swaps every label for the
chosen output language using `## Labels`, and follows `## Section rules` for what each section may
hold and when it is left out.

Placeholders are `<angle-bracketed>`. Anything outside the angle brackets is fixed text.

There is no issue number in the title, because git assigns its own when the issue is created.

---

## Structure

```markdown
# <Title>

**Affected system:** <Affected system>
**Reported by:** <Reported by>

## Description

<Clear, concise description of the reported issue and observed behaviour. Do not speculate about the cause.>

## Steps to reproduce

1. <Step 1>
2. <Step 2>

## Expected vs actual

**Expected:** <What should happen.>
**Actual:** <What happens instead.>

## Acceptance Criteria

- <Criterion 1>
- <Criterion 2>

## Impact

<What is affected and the practical impact.>

## Workaround

<Any known temporary workaround.>

## Investigation

<Troubleshooting that has actually been done, and what it found.>

## Resolution

TODO
```

---

## Section rules

| Section | Rule | When empty |
|---|---|---|
| Title | Short, plain summary of the problem. | Never empty. |
| Affected system | As stated or confirmed by the user. | Ask. `TODO` if the question limit means it was not asked. |
| Reported by | Always asked, every run. Never taken from the paste, git, or the system without the user confirming it. | Never empty: always asked. |
| Description | Observed behaviour only, with no cause. | Never empty. |
| Steps to reproduce | Only steps the paste or the user states. Never invent steps. | Ask. If the user answers that the steps are unknown or it can't be reproduced, leave the section out. |
| Expected vs actual | Only when the paste states, or directly implies, both what should happen and what happens instead. | Leave the section out. |
| Acceptance Criteria | Optional but preferred. Derive from the expected behaviour the paste describes, for example "it should…" or "moet eintlik…", or from the user's answer. Use as many bullets as there are criteria. | Leave the section out. |
| Impact | May be inferred, but only when it follows directly from the described behaviour. | Leave the section out. |
| Workaround | Optional. Only a workaround the paste or the user states. | Leave the section out. |
| Investigation | Only troubleshooting already done, plus any cause the user *suspects* from it. A suspected cause belongs here, never in Description. Never planned steps or guesses. | `TODO` |
| Resolution | Always `TODO`. The ticket is logged before anything is fixed. | `TODO` |

`TODO` stays `TODO` in both languages.

---

## Questionnaire

Asked in this order, within the skill's limit of 3 questions:

1. **Reported by**: always asked.
2. **Steps to reproduce**: only when the paste gives none. Offer "Unknown / not reproducible"
   as an option, which leaves the section out. The user types the steps through "Other".
3. **Affected system**: only when missing or unclear. Offer candidates the paste suggests.
4. **Acceptance Criteria**: only when none could be derived. Offer "Leave out" as an option.

If more than 3 of these are needed, ask the first 3 in this order. Anything not asked follows its
"When empty" rule (Acceptance Criteria is left out; Affected system becomes `TODO`).

Never ask about Expected vs actual, Impact, Workaround, Investigation, or
Resolution. Their rules above decide them.

---

## Labels

The left column is what the structure above uses. When Afrikaans is chosen, replace every label
with its right-hand counterpart.

| English | Afrikaans |
|---|---|
| Affected system | Geaffekteerde stelsel |
| Reported by | Gerapporteer deur |
| Description | Beskrywing |
| Steps to reproduce | Stappe om te herhaal |
| Expected vs actual | Verwag teenoor werklik |
| Expected | Verwag |
| Actual | Werklik |
| Acceptance Criteria | Aanvaardingskriteria |
| Impact | Impak |
| Workaround | Tydelike oplossing |
| Investigation | Ondersoek |
| Resolution | Oplossing |
