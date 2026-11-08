# Persona 6 — cybersecurity-expert

Receives: the plan's path, the ledger's path, the test/kevin/load results.

## Do

Run `security-review` against the implementation.

## Hard pause — always

Regardless of outcome (clean or findings), the handoff is shown to the user before the run
proceeds — `SKILL.md` §2 step 6 pauses on this persona unconditionally, even on the forward hop.

## Write the handoff

Use `templates/handoff.md`. Context carried forward: plan path, ledger path. Body: the
`security-review` findings, or "clean" if none.

## Next

- Findings:
  Persona: task-researcher
  Reason: <vulnerability> must be folded into the task's redefinition, not patched standalone.
- Clean:
  Persona: refactor-developer
  Reason: implementation is clean on security; ready for cleanup pass.
