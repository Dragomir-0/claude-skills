# Feature request ticket template

Purpose: New functionality or a change in behaviour — what is wanted, why, any proposed approach, acceptance criteria, and what is out of scope.

Read by `generate-git-ticket` when it is invoked with `--feature-request`. This file is the
**only** place this ticket's structure is defined, so you change the format here and not in the
skill. The skill fills the `## Structure` block, asks what `## Questionnaire` allows, swaps every
label for the chosen output language using `## Labels`, and follows `## Section rules` for what
each section may hold and when it is left out.

Placeholders are `<angle-bracketed>`. Anything outside the angle brackets is fixed text.

There is no issue number in the title, because git assigns its own when the issue is created.

---

## Structure

```markdown
# <Title>

**Affected system:** <Affected system>
**Requested by:** <Requested by>

## Summary

<What is being requested, in one or two plain sentences.>

## Problem / motivation

<Why it is needed: the problem or limitation it addresses.>

## Proposed solution

<The approach the requester has in mind.>

## Acceptance Criteria

- <Criterion 1>
- <Criterion 2>

## Out of scope

- <Item 1>
```

---

## Section rules

| Section | Rule | When empty |
|---|---|---|
| Title | Short, plain summary of the request. | Never empty. |
| Affected system | As stated or confirmed by the user. | Ask. |
| Requested by | Always asked, every run. Never taken from the paste, git, or the system without the user confirming it. | Never empty: always asked. |
| Summary | What is wanted, as the paste describes it. | Never empty. |
| Problem / motivation | Only the reason the paste or the user gives. Never invent a justification. | Leave the section out. |
| Proposed solution | Only an approach the paste or the user states. Never design one. | Leave the section out. |
| Acceptance Criteria | Optional but preferred. Derive from the outcome the paste describes, for example "it should…" or "moet kan…", or from the user's answer. Use as many bullets as there are criteria. | Leave the section out. |
| Out of scope | Only exclusions the paste or the user states. | Leave the section out. |

---

## Questionnaire

Asked in this order, within the skill's limit of 3 questions:

1. **Requested by**: always asked.
2. **Affected system**: only when missing or unclear. Offer candidates the paste suggests.
3. **Acceptance Criteria**: only when none could be derived. Offer "Leave out" as an option.

Never ask about Problem / motivation, Proposed solution, or Out of scope. Their rules above
decide them.

---

## Labels

The left column is what the structure above uses. When Afrikaans is chosen, replace every label
with its right-hand counterpart.

| English | Afrikaans |
|---|---|
| Affected system | Geaffekteerde stelsel |
| Requested by | Aangevra deur |
| Summary | Opsomming |
| Problem / motivation | Probleem / motivering |
| Proposed solution | Voorgestelde oplossing |
| Acceptance Criteria | Aanvaardingskriteria |
| Out of scope | Buite omvang |
