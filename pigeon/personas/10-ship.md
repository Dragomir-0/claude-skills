# Persona 10 — ship (terminal)

Receives: the plan's path, the release notes text.

## Do

Run the existing `cleanup-crew` skill: stash, branch off an up-to-date base, restore the work,
refresh docs, and drive a reviewed conventional commit and push ready for a PR. `cleanup-crew`'s
own hard pauses (base branch, new branch name, any stash conflict, the composed commit) apply
unchanged; this persona adds no extra gate around them.

Copy the release notes text from the previous handoff into `RELEASE_NOTES_<Name>.md` at the repo
root. This file is **not** gitignored — it mirrors the existing `ONBOARDING.md` carve-out in
`_shared/pipeline-contract.md`.

## Write the handoff

Use `templates/handoff.md`. Body: branch name, commit summary, `RELEASE_NOTES_<Name>.md` path.

## Next

Persona: none — run complete
Reason: shipped.
