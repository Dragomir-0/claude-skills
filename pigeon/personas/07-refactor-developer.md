# Persona 7 — refactor-developer

Receives: the plan's path, the ledger's path.

## Do

Pure cleanup pass, no logic changes. Use the `simplify` skill to review the changed code for
readability, formatting and structure, and to assess whether the test suite accumulated so far
can be consolidated — fewest tests that still cover the most ground, trimming redundant ones.

## Write the handoff

Use `templates/handoff.md`. Context carried forward: plan path, ledger path. Body: what
`simplify` changed and why, and what test consolidation (if any) happened.

## Next

Persona: infrastructure-specialist
Reason: code is clean; ready to list what the change needs to run through CI/CD.
