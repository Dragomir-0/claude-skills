# Task spec — <target skill> — AREA=<area>

- Run folder: <path>
- LIMIT: <tokens> · MAX_SEGMENTS: <n> · Task target: <tokens>
- Pre-answered parameters: <list, or none>

## Hard rules
<contents of hard-rules.md, with any non-applicable line removed>

## Tasks (run in order)

### T1 — <title>
- Source step: <target skill section/step>
- Class: haiku
- Depends on: none
- Inputs: <exact paths / prior task outputs>
- Instructions: <self-contained, the target skill's wording inlined>
- Outputs: <exact paths / notes.md entries>
- Done-check: <mechanical command or condition>
- Est tokens: <n>
- Side effects: <files, rows, or none>

### P1 — <title> (pause)
- Source step: <target skill section/step>
- Class: pause
- Reason: <why the user must decide>
- Main session must: <what to do or ask, then append `DONE-MAIN P1` to progress.log>

### M1 — <title> (main)
- Source step: <target skill section/step>
- Class: main
- Reason: <judgment or scoring that stays with the main session>
- Main session must: <what to do, then append `DONE-MAIN M1` to progress.log>
