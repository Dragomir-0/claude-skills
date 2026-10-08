# Basic ticket template

Purpose: General-purpose ticket — a title, who raised it, what it's about, and optional acceptance criteria. The default when no flag is given.

Read by `generate-git-ticket` when it is invoked with `--basic` or with no template flag. This
file is the **only** place this ticket's structure is defined, so you change the format here and
not in the skill. The skill fills the `## Structure` block, asks what `## Questionnaire` allows,
swaps every label for the chosen output language using `## Labels`, and follows
`## Section rules` for what each section may hold and when it is left out.

Placeholders are `<angle-bracketed>`. Anything outside the angle brackets is fixed text.

There is no issue number in the title, because git assigns its own when the issue is created.

---

## Structure

```markdown
# <Title>

**Affected system:** <Affected system>
**Reported by:** <Reported by>

## Description

<Clear, concise description of what the ticket is about.>

## Acceptance Criteria

- <Criterion 1>
- <Criterion 2>
```

---

## Section rules

| Section | Rule | When empty |
|---|---|---|
| Title | Short, plain summary. | Never empty. |
| Affected system | Only if stated or unambiguous. Not asked. | Leave the line out. |
| Reported by | Always asked, every run. Never taken from the paste, git, or the system without the user confirming it. | Never empty: always asked. |
| Description | What the paste describes, stated plainly. Do not speculate about causes or solutions. | Never empty. |
| Acceptance Criteria | Optional but preferred. Derive from the expected outcome the paste describes, for example "it should…" or "moet eintlik…", or from the user's answer. Use as many bullets as there are criteria. | Leave the section out. |

---

## Questionnaire

Asked in this order, within the skill's limit of 3 questions:

1. **Reported by**: always asked.
2. **Acceptance Criteria**: only when none could be derived. Offer "Leave out" as an option.

---

## Labels

The left column is what the structure above uses. When Afrikaans is chosen, replace every label
with its right-hand counterpart.

| English | Afrikaans |
|---|---|
| Affected system | Geaffekteerde stelsel |
| Reported by | Gerapporteer deur |
| Description | Beskrywing |
| Acceptance Criteria | Aanvaardingskriteria |
