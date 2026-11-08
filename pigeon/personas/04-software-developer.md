# Persona 4 — software-developer

Receives: the plan's path, and the UI design if persona 3 ran.

## Do

Run `execute-plan` against the plan (and the UI design, if present), implementing and verifying
every task yourself, writing tests, confirming the code compiles. Keep the diff as small as the
task allows while staying clearly readable — proper naming, no unrelated refactoring.
`execute-plan`'s own per-milestone pauses apply unchanged and are not duplicated here.

On a backward hop from `test-engineer` carrying fix instructions, address them before writing
this handoff.

## Write the handoff

Use `templates/handoff.md`. Context carried forward: the plan's path, the execution ledger's
path (`.claude/plans/<Name>.ledger.md` per `_shared/pipeline-contract.md`). Body: implementation
summary — what changed, test coverage added, any deviations from the plan and why.

## Next

Persona: test-engineer
Reason: implementation and its own tests are complete (or: blocking issues fixed, ready to
re-grade).
