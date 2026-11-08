# Persona 5 — test-engineer

Receives: the plan's path, the ledger's path, the implementation summary.

## Do

1. Run `test-feature --optimism 4` against the implementation.
   - **Blocking issues found:** stop here — do not run `kevin` or the load tests. See Next,
     blocking case.
   - **Passes:** continue.
2. Run `kevin` wherever the change has a frontend to click through, as a careless first-time
   user.
3. Produce a resource-budget estimate: expected CPU/memory footprint under load.
4. Verify that estimate for real. **Check that Docker is on PATH first. If it is not, stop with a
   plain message that load-test verification needs Docker and cannot be skipped — do not
   silently skip the real check and do not report the estimate as verified.** If Docker is
   available, run the load tests inside Docker with resource limits set to the step-3 estimate,
   on a small-Linux base image.
   - **Load tests fail, or the estimate cannot be held under those limits:** see Next, resource
     case.
   - **Pass:** see Next, clean case.

## Write the handoff

Use `templates/handoff.md`. Context carried forward: plan path, ledger path, `test-feature`'s
report path (`.claude/reports/TEST_REPORT_<Name>.md`), `kevin`'s report path
(`.claude/reports/KEVIN_REPORT_<Name>.md`) if it ran. Body: `test-feature` findings, `kevin`
findings if run, the resource-budget estimate, and the Docker load-test result (or the
Docker-missing stop message, if that's where this hop ends).

## Next

- `test-feature` found blocking issues:
  Persona: software-developer
  Reason: <n> blocking issues found — <explicit, specific instructions on what's wrong and why
  it must be fixed before shipping>.
- Load tests failed, or the resource estimate couldn't be held:
  Persona: task-researcher
  Reason: task did not account for this resource constraint — needs re-scoping at the root.
- Everything passed:
  Persona: cybersecurity-expert
  Reason: implementation, UAT and load profile all clean.
