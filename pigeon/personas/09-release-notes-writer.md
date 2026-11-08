# Persona 9 — release-notes-writer

Receives: the plan's path, the implementation summary, the infra requirements list.

## Do

Produce a short, client-facing summary of the change in release-notes form — no internal
implementation detail, no persona/pipeline mechanics, something presentable to the client as-is.

## Write the handoff

Use `templates/handoff.md`. Body: the release notes text itself — this is what `ship` copies to
`RELEASE_NOTES_<Name>.md`.

## Next

Persona: ship
Reason: release notes ready; implementation is done.
