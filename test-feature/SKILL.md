---
name: test-feature
description: >
  Grade an implemented feature against its plan at a chosen rigour level (--optimism 1-5),
  measuring real coverage at level 3 and above, judging test effectiveness, and checking
  completeness, security, deployment, pipeline and efficiency vectors. Writes only a test
  report, never source. Triggered by /test-feature.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion
---

# test-feature

## Constraint — read this first

**This skill writes exactly one file: the report. It never edits source and never commits.**

You diagnose and recommend. Fixes go back through `/execute-plan`, or to `/simplify` for
mechanical cleanups. A reviewer that silently rewrites the code under review has destroyed the
evidence.

**Never spawn subagents.** Run every step of this skill — stack detection, coverage runs, every
evaluation vector, and the §7 correctness pass — in the current session yourself. Dispatching a
subagent for a vector or a repo fragments the evidence trail this report depends on.

Usage: `/test-feature --plan <path to FEATURE_PLAN_<Name>.md> --optimism <1-5>`

Artifact paths come from `~/.claude/skills/_shared/pipeline-contract.md`. The model floor below
comes from `~/.claude/skills/_shared/complexity-scoring.md`. Capture the diff of the files listed
in the plan's File Impact Manifest — `git diff` plus `git diff --staged`, falling back to the
working tree if nothing is staged.

## 0 — Locate the plan

- An explicit `--plan` argument.
- Else, if the invocation names a specific feature, search `.claude/plans/FEATURE_PLAN_*.md` (the
  container too, in a workspace) for a plan matching it — by title or filename, not necessarily an
  exact string match. More than one plausible match → ask which one, listing the candidates.
- A feature was named but no plan matches it → consult the map files instead
  (`.claude/maps/index.md`, then the relevant domain map) to find the feature's functional area,
  then capture the diff from the full working tree (`git diff` / `git diff --staged`) rather than
  a File Impact Manifest, since none exists. Grade the Completeness vector (§5.1) against what the
  map says the feature should do, and say plainly in the report's header that no formal plan
  existed for this run.
- No feature was named at all → the newest `.claude/plans/FEATURE_PLAN_*.md` (container too, in a
  workspace).
- Still nothing usable → ask.

## 0b — Model floor

Read the plan's `**Complexity:**` line (from the plan §0 located, if one was found) — reuses
`plan-feature`'s feature-level score rather than computing a new one, so grading rigor tracks
design rigor. Look the required tier up deterministically rather than re-reading the table by eye:

```bash
# --optimism 1-3, any plan complexity
node ~/.claude/skills/tooling/cli.mjs complexity-scoring.modelForGate '["gradingLevel", null, {"mode":"test-feature-low-optimism"}]'
# --optimism 4-5, with the plan's Complexity score
node ~/.claude/skills/tooling/cli.mjs complexity-scoring.modelForGate '["gradingLevel", <score>, {"mode":"test-feature-high-optimism"}]'
```

Returns `{"model": "sonnet5" | "opus5", "note": "..."}`. Check the required tier against the model
actually powering this session. If the session already meets or exceeds it, continue. If not, tell
the user the plan's complexity, the chosen `--optimism` level, and the required tier; ask them to
switch (`/model`) and wait — don't grade a High-complexity feature at optimism 4-5 under a
lower-tier model "just this once." If they explicitly choose to proceed anyway, note it in the
report's header so `/execute-plan`'s correction loop and any later reviewer can see the report was
produced below the required tier.

No plan, or a plan with no `**Complexity:**` line (per §0's no-plan fallback)? There's no design
score to match — call the `test-feature-low-optimism` lookup regardless of the chosen `--optimism`
level; it's a flat Sonnet 5 floor either way.

## 1 — Optimism scale

`--optimism` drastically alters your posture. Default to **3** if omitted.

| Level | Posture | Runs tests? |
|---|---|---|
| **1** Fully optimistic | Assume the code works. Basic completeness check against the plan. Glaring syntax errors or catastrophic build failures only. | No |
| **2** Standard | Basic logic flaws and standard best practices. | No |
| **3** Thorough *(default)* | Investigate edge cases. Common security vulnerabilities (SQL injection, XSS) and basic performance bottlenecks. | **Yes** |
| **4** Pessimistic | Actively look for ways the code will break. Scrutinise data bounds, error handling, thread safety, resource leaks. | **Yes** |
| **5** Paranoid | Trust nothing. Assume the code is fragile and under attack. Obscure vulnerabilities, catastrophic deployment hazards, severe algorithmic inefficiency. | **Yes** |

Levels 1–2 reason statically over the diff and are cheap. Levels 3–5 build and run for real, and
cost accordingly — say so before starting a level 4 or 5 run on a large repo.

## 2 — Stack detection and coverage

Detect by marker file and run the matching command at optimism 3+:

`map.mjs scan` reports the detected stack. Match it to a command:

| Stack | Marker | Coverage command |
|---|---|---|
| dotnet | `*.csproj` / `*.sln` | `dotnet test --collect:"XPlat Code Coverage"` |
| flutter | `pubspec.yaml` | `flutter test --coverage`, then parse `coverage/lcov.info` |
| node | `package.json` (jest/vitest) | `npm test -- --coverage` |
| python | `pyproject.toml`, `pytest.ini`, `requirements.txt`, `setup.py` | `pytest --cov` |
| go | `go.mod` | `go test -cover ./...` |
| jvm | `pom.xml`, `build.gradle` | `mvn verify` (JaCoCo) or `./gradlew test jacocoTestReport` |
| android | `AndroidManifest.xml` | `./gradlew testDebugUnitTest` |
| rust | `Cargo.toml` | `cargo test`; coverage via `cargo llvm-cov` if present |
| ruby | `Gemfile` | `bundle exec rspec` or `rake test`; coverage via SimpleCov |
| php | `composer.json` | `vendor/bin/phpunit --coverage-text` |
| cpp | `CMakeLists.txt` | `ctest`; coverage via gcov/lcov if configured |
| swift | `Package.swift` | `swift test --enable-code-coverage` |
| elixir | `mix.exs` | `mix test --cover` |

**Confirm before running.** Outside .NET and Node the coverage tooling is optional and often
absent — `cargo llvm-cov`, SimpleCov and gcov are all opt-in. Check the project's own scripts
(`package.json`, `Makefile`, `mix.exs`, CI config) and its `projectDocs` first; **the project's
documented command always beats the table above.** If no tooling is configured, say so and fall
back to running the plain test command without coverage.

**If the stack is unrecognised**, do not guess a command. Say the stack was not identified, list
the file extensions actually present, and **ask the user for the build and test commands.** A
wrong command wastes a run and can produce misleading output; asking costs one question.

Parse into overall % and per-file %, then bucket:

- **Critical** — 0% covered
- **Partial** — 1–79%
- **Compliant** — ≥ 80%, or the project's own contractual threshold if it has one

For changed and critical files, **list the specific uncovered lines and branches**.

If no marker matches, or the repo has no test projects at all, say so explicitly and switch to
static reasoning for the rest of the review.

**Read the repo's own docs before judging anything.** `map.mjs scan` reports them as
`projectDocs`. A `CLAUDE.md` or `ONBOARDING.md` states the real build and test commands, the
required SDK versions, and the gotchas — grading code against an architecture you inferred
produces confident findings about problems that do not exist.

### Cross-repo features

If the plan names more than one repo (its `**Repos:**` line and the manifest's Repo column):

- **Detect and run each repo's own test command separately.** Stacks differ; one repo may be
  .NET and another Angular. Never apply one repo's command to another.
- **Report coverage per repo**, each with its own buckets and its own evidence, then give a
  **single combined verdict**. A workspace is shippable only if every affected repo is.
- **A repo with no test project is reported as such**, not silently skipped. "No tests exist" is
  a finding.
- **Check that the repos still agree.** Each repo passing its own tests says nothing about the
  contract between them. Verify that a changed route, DTO, queue message shape or generated
  client was updated on both sides — this is the failure mode unit tests structurally cannot
  catch, and at optimism 3+ it is mandatory.

## 3 — Evidence before assertions

**Never state a coverage number, a pass/fail, or a "tests are effective" claim without showing
the command output it came from.** Run the real tools whenever the project builds. If the build
fails or the tooling is missing, say so explicitly and fall back to static reasoning — clearly
labelled as an estimate, not a measurement.

## 4 — Test effectiveness

Coverage is not quality. Flag:

- Tests that **execute code without asserting** anything meaningful.
- Missing **edge cases, error paths, and boundary values**.
- **Tautological mocks** — "mock returns X, assert X" — that verify nothing real.
- **Coverage theatre** — lines counted as covered but never actually asserted.
- High-coverage, low-value tests. Recommend **mutation testing** where the stronger signal would
  be worth the cost.

## 5 — Mandatory evaluation vectors

Every level evaluates all five. Intensity scales with optimism; **none may be skipped.**

1. **Completeness** — does the code fulfil every requirement and milestone in the plan file?
2. **Vulnerabilities and security hazards** — authentication bypasses, injection flaws, data
   leaks.
3. **Deployment hazards** — missing environment variables, conflicting dependency versions,
   database migration risks. For a cross-repo change, also: **is the deployment ordering the plan
   stated actually safe**, and is either repo deployable alone without breaking the other?
4. **Pipeline hazards** — will this break CI/CD? Are build times impacted? Are tests missing or
   brittle?
5. **Efficiency** — algorithmic complexity (Big O), redundant queries (N+1), memory leaks, slow
   response times.

## 6 — Stack-specific checklist

Apply the checklist for the **detected stack only**. If the stack is not listed here, apply the
five mandatory vectors and say plainly that no stack-specific checklist was available — do not
transplant one stack's idioms onto another.

### .NET

- **LINQ / data:** N+1 query patterns. `.ToList()` called before filtering.
- **Architecture:** dependency injection bypassed. Controllers bloated with business logic.
- **Security:** user input unsanitised. Secrets hardcoded.
- **C# practice:** async methods missing `ConfigureAwait` or `CancellationToken`. Nulls handled
  properly. Async state machine and GC traps.

### JS / TS / Node

Unawaited promises and floating rejections. `any` used to silence the compiler. Blocking work on
the event loop. Dependency and lockfile drift. Secrets in client-side bundles.

### Python

Mutable default arguments. Bare `except`. Unpinned dependencies. Blocking I/O in async code.
String-built SQL.

### JVM

Resources not closed (try-with-resources). Swallowed exceptions. N+1 in JPA/Hibernate. Mutable
static state and thread-safety in singletons.

### Go

Ignored `error` returns. Goroutine leaks and missing context cancellation. Captured loop
variables. `defer` inside a loop.

### Ruby / PHP

Mass assignment without strong parameters. N+1 in ActiveRecord/Eloquent. Unescaped output in
views. Unsanitised input reaching a query.

### Rust

`unwrap`/`expect` on recoverable errors. `unsafe` without an invariant comment. Blocking calls in
async contexts.

---

**Explain *why* a finding is wrong, not just how to fix it.** Never hand over a refactored block
with no reasoning. If the code is clean, say so — do not invent issues.

## 7 — Correctness pass

Never invoke the `code-review` skill (or `/code-review`) from here, in any mode — it launches as a
background/forked subagent regardless of its own or the project's no-subagent instructions, which
this skill's evidence trail cannot tolerate. Instead, apply `code-review`'s own dimensions to the
same diff yourself, inline, in this session: correctness bugs, reuse/simplification opportunities,
and efficiency cleanups. De-duplicate against findings you already made in §4–§6 before reporting.

## 8 — Output

Write `.claude/reports/TEST_REPORT_<Name>.md`:

```markdown
# Test Report — <Name>
Plan: <path, or "none — sourced from map files (<paths>)" per §0>   Optimism: <n>   Generated: <ISO date>

## Verdict
<one line: ship / fix first / do not ship>

## Passes
## Warnings
## Critical Failures

## Coverage
<per repo: overall %, per-file buckets, uncovered lines, with the command output as evidence>

## Cross-repo contract
<only when the change spans repos: is each side of every changed contract updated?>

## Correction Plan
1. [repo] <atomic fix — file, what, why>
2. ...
```

The **Correction Plan** must be a numbered list of atomic fixes, each phrased so
`/execute-plan`'s decomposer can consume it directly as a task list. **Each item names its repo**,
matching the plan's manifest. Vague entries like "improve error handling" are useless there — name
the repo, the file, the change, and the reason.

For a cross-repo feature the report goes to `<container>/.claude/reports/TEST_REPORT_<Name>.md`.

## Common mistakes

- Editing source. This skill writes one file: the report.
- Spawning a subagent for any part of the grading, including the §7 correctness pass.
- Quoting a coverage number without the command output that produced it.
- Reporting "tests pass" when the build actually failed.
- Skipping a mandatory vector because the optimism level is low. Scale intensity, never skip.
- Grading a High-complexity plan at optimism 4-5 under a model below the required tier instead of
  telling the user and asking them to switch.
- Invoking `/code-review` or the `code-review` skill at all — it forks a subagent regardless of mode; do the correctness pass inline instead.
- Applying the .NET checklist to a Flutter or Node repo — or to the wrong repo in a workspace.
- A Correction Plan that `/execute-plan` cannot decompose, or one that omits the repo per item.
- Declaring a cross-repo change clean because each repo passed its own tests. Check the contract.
- Judging architecture from directory names when the repo has a `CLAUDE.md` that says otherwise.

## Next step

If the Correction Plan is non-empty, `/execute-plan` consumes it. If it is empty and the verdict
is ship, `/cleanup-crew` prepares the pull request. Name the relevant one; do not invoke it.
