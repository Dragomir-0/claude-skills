---
name: map-codebase
description: >
  Use when a repository or multi-repo workspace needs its architecture map built or refreshed:
  before planning a feature, when no maps exist or a drift check reports cited paths that no
  longer resolve, or when a session would otherwise have to read source to learn how a feature
  flows end to end. Invoked as /map-codebase.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Artifact
---

# map-codebase

## Overview

A map exists so a future session can understand the **bigger picture** — what a feature flow
does, where it lives, and what it touches — without scanning raw code. High signal, low tokens.

**The script does all deterministic work.** Always run `map.mjs` before any `Glob` or `Grep`, and
never re-walk the tree by hand. Walking, stack detection, entry-point discovery, change detection
and drift checking cost nothing when the script does them and a great deal when you do.

```
node ~/.claude/skills/map-codebase/map.mjs scan       # inventory + directory tree
node ~/.claude/skills/map-codebase/map.mjs update     # changed files, grouped by owning map
node ~/.claude/skills/map-codebase/map.mjs verify     # drift check; exit 1 = drifted
node ~/.claude/skills/map-codebase/map.mjs gitignore --write
```

Every command accepts `--root <dir>`. If the user invoked `/map-codebase --root <dir>`, pass it
straight through — and write the maps under **that** repo. `scan` and `update` cap their lists to
stay cheap; `--full` lifts the caps when you genuinely need everything.

Artifact paths, repo resolution, `<Name>` derivation, workspace rules, the read-only guardrail and
cost discipline live in `~/.claude/skills/_shared/pipeline-contract.md`. Read it; do not restate it.

## 0 — Model floor

Check the required tier for the invoked mode (full build, `--update`, or `--verify`) against
`~/.claude/skills/_shared/complexity-scoring.md`'s Map-level table, then against the model actually
powering this session. If it falls short, tell the user and ask them to switch (`/model`) before
proceeding, and wait — don't run a build or update under a lower tier "just this once." If they
explicitly choose to proceed anyway, note it in `index.md`'s header.

## Preflight

1. **Run `map.mjs scan`** and use the `root` it reports. If it exits 3 with
   `"error": "not a git repository"`, say so plainly and stop — a folder that merely *contains*
   repos is not a repo, and the script refuses rather than scanning it.

2. **Read `maps.readFirst` in the scan output.** When maps already exist, their search-hints
   ledger tells you where things are for a fraction of the cost of finding them again. That
   ledger is the whole reason the last run wrote one. Read it before touching the filesystem.

3. **Read the project's own docs before inferring anything.** `scan` reports them as
   `projectDocs`, agent-directed files first (`CLAUDE.md`, `AGENTS.md`, `ONBOARDING.md`), then
   `README.md` and friends.

   **A repo that documents itself is the authority on its own architecture.** Where a doc
   disagrees with what directory names suggest, the doc wins — and say so in the map. Skipping
   this produces maps that are confidently wrong in ways `verify` cannot catch, because every
   cited path still exists. Real examples from a single run: a `DbContext` placed in `DAL/` when
   it lives in a shared library; two WinForms dev tools drawn into a live ingestion path; a "root
   solution" that does not exist.

   If a doc is long, read the sections covering architecture, build and gotchas. Cite it in the
   map as authoritative, and say plainly if you did not read it in full.

4. **Run `map.mjs gitignore --write`** if the scan reports `gitignore.missing`. It appends the
   artifact directories and touches nothing else.

## Modes

| Mode | Script call | What you do |
|---|---|---|
| **Full build** (default) | `scan` | Write `index.md`, a root `ARCHITECTURE_MAP.md`, and one map per domain. |
| `--update` | `update` | Regenerate **only** the maps whose `regenerate` is true. Leave every other map untouched; still fold new locations into the ledger. |
| `--verify` | `verify` | Run the script, report its JSON, **stop**. No model reasoning, no file reads. |
| **Workspace** | `workspace` / `edges` | See `workspace.md`. |

**Every mode that writes a map also publishes it** — see `## Publishing`. A full build publishes
every file it wrote; `--update` publishes only the maps it regenerated, plus `index.md`.
**`--verify` publishes nothing.**

`--verify` is deliberately cheap. `cleanup-crew` calls it before every commit, so it must stay
that way — never "improve" it by having the model inspect the code as well, and never by having it
publish.

**Finish every build and update by running `verify`.** It is the only thing that proves the paths
you just cited resolve, and it costs one Bash call. A build that ends without it ships typos.

## Domains

`scan` returns a `tree`: the top directory levels with file counts and dominant extensions. Carve
domains from that, not from taste.

- A **domain** is one end-to-end feature area — the set of files a single feature request would
  touch together.
- Anchor each on something that runs: an entry point, a controller or route group, a screen, a
  queue consumer. Include the services and data access it calls.
- **Name it for what it does** (`orders`, `asset-import`), never for a layer. `services/`,
  `controllers/` and `models/` are not domains; a flow crosses all of them.
- **Target 3–8.** Under 3 and the map says nothing a directory listing would not. Over 8 and you
  are mapping folders rather than features — merge them.
- A directory in no flow gets no map. List it under `## Not mapped` in `index.md` with one line
  saying why.

One file per domain: `.claude/maps/<domain>.md`, kebab-case, matching the name in `index.md`.

## What to write

Both files carry `Generated: <ISO date> (<short sha>)` as their second line. The sha is the
baseline `update` diffs against — **without it, `--update` cannot see committed work at all** —
and the date is what the staleness check reads.

### `index.md`

```
# <Repo> map index
Generated: 2026-08-27 (a1b2c3d)

## Domains
| Domain | Map | Covers |
|---|---|---|
| orders | `.claude/maps/orders.md` | capture through dispatch |

## Not mapped
- `tools/` — dev-only utilities, no runtime flow

## Authority
CLAUDE.md says <X>. Where it disagreed with directory names, it won.

## Build & test commands
- build: `<command>`
- test: `<command>`

## Search hints
<topic> -> <dir/file glob>   (verified <date>; ~<tokens> to locate)

## Published artifacts
| Map | Artifact |
|---|---|
| index.md | https://claude.ai/code/artifact/... |
| orders.md | https://claude.ai/code/artifact/... |
```

`## Published artifacts` sits last on purpose: it is run bookkeeping, and the top of `index.md`
should stay dense with what the next session actually needs.

### `ARCHITECTURE_MAP.md` and each `<domain>.md`

```
# <Domain>
Generated: 2026-08-27 (a1b2c3d)

## Structure
- `src/Orders/Api/OrdersController.cs` — HTTP surface
- `src/Orders/Services/OrderService.cs` — capture and validation

## Flow: <name>
**Purpose** — what this accomplishes, in prose.
**In / out** — the shapes crossing the boundary, not their implementations.
**Call order**
1. `src/Orders/Api/OrdersController.cs` — one line on what it does
2. `src/Orders/Services/OrderService.cs` — one line
**Side effects**
- db: Orders insert
- queue: ServiceBus:OrderQueue publish
- (none — say so explicitly rather than leaving the heading out)
```

Rules the format depends on:

- **Cite paths in backticks**, exact and repo-relative. The drift checker only sees backticked
  tokens that contain a slash and end in a file extension; a path written any other way is
  invisible to `verify`. Get the **case** right — a wrong-cased path is now reported as drift.
- **`## Structure` is required.** The staleness spot-check globs its first three entries.
- **Enumerate side effects explicitly**, never by implication: database writes (table +
  operation), external API calls (service + endpoint), queue publishes and consumes (queue/topic
  name, including LocalStack), file system writes, cache invalidations.
- **Mermaid diagram only where a flow exceeds three steps.** A diagram for a two-step flow is
  noise that costs tokens to read.
- **Abstract the *how*; detail the *what* and *where*.** No function bodies, no code dumps, no
  boilerplate. If you are tempted to paste a method, write the sentence that says what it does
  and cite its path.

### Build and test commands

`## Build & test commands` is the **one** section of a map allowed to contain a command, and the
contract's read-only guardrail carves it out explicitly: it is recorded as *data* for
`/test-feature`, never as an instruction for the reading run to execute. `verify` enforces that
boundary — a shell block anywhere else is a guardrail violation and fails the check.

Record the command from the repo's own docs. If `scan` reports `stackHint`, **ask the user**
rather than inferring, and write down which source you used.

### When the codebase is unfamiliar

`scan` reports `stacks: []` and a `stackHint` when it finds no build manifest it knows. Recognised
stacks: dotnet, node, deno, python, go, jvm, android, flutter, rust, ruby, php, cpp, swift, elixir.
Docker, Terraform, Bicep and Kubernetes are reported separately under `infra`.

**Say so in the map. Do not guess.** Write what is observable — the extensions present, the
directory shape, the CI files by name — and state plainly that the stack was not identified. An
honest "stack not recognised; commands supplied by the user" is useful. A confidently wrong stack
label is worse than none, because everything downstream trusts it.

## Search hints ledger

`index.md` carries an **append-only** `## Search hints` section. Every run adds the locations it
discovered and corrects any hint that proved stale.

```
<topic> -> <dir/file glob>   (verified <date>; ~<tokens> to locate)
```

Never finish a run without folding newly discovered locations back into the ledger — that is the
whole mechanism, and skipping it makes the next run pay this run's discovery cost again.

## Publishing

**Every map this skill writes is also published as an Artifact.** The file on disk stays the
source of truth that `/plan-feature` and `/execute-plan` read; the artifact is the copy a person
can open and share without cloning the repo. One artifact per file, `index.md` included — a run
that writes seven files publishes seven artifacts.

### Model

**Never spawn a subagent for this.** By the time a map reaches this section its content is
finished and has passed `verify` — publishing is a mechanical read-URL/call-tool loop, but you do
it yourself, in this session: one file at a time, or the whole batch when several maps changed in
a run. For a republish, read the existing URL from `## Published artifacts` first — the tool
refuses to overwrite an artifact this conversation hasn't read — then publish and fold the
resulting URL(s) into `## Published artifacts` yourself.

**Publish the `.md` file itself.** This is the explicit skill instruction the Artifact tool's
format rule requires, and it is deliberate: rendering a map as HTML would fork its content, and a
forked copy drifts from the file `verify` checks. Pass the map's path straight to the Artifact
tool — no rewriting, no design pass, no `artifact-design`.

Per file, pass:

- **`file_path`** — the map on disk.
- **`description`** — `<repo> · <what this map covers>`. A markdown artifact takes its filename as
  its title, so several repos will each contribute a `data-layer`; the description is the only
  thing separating them in the gallery. Make it specific.
- **`favicon`** — on a first publish only. Pick one emoji for the whole run so a repo's maps read
  as a set. Never pass it on a redeploy: the icon is how someone finds the tab again.

### Republish, never duplicate

`index.md` carries a `## Published artifacts` table pairing each map with its URL. **Read it
before publishing anything.** For every map already listed, pass its `url` so the publish
**updates that artifact in place**. Publishing without `url` from a later session creates a
*second* artifact instead, and the link a teammate bookmarked quietly goes stale.

The tool refuses to overwrite an artifact this conversation has not read, so on `--update`: read
each URL first, then build the republish on what came back. Write the table back afterwards,
adding a row for every map published for the first time.

Record the URLs as plain markdown links, **not in backticks**. `verify`'s drift checker only
inspects backticked tokens, and a URL has no business being resolved as a repo path.

### Guardrail

Publishing sends the map to an external service. Artifacts start private, but the copy has left
the machine either way — so the contract's read-only guardrail matters more here, not less:

**Run `verify` before publishing, not after.** Its `guardrail` array is the only thing standing
between a secret-shaped string in a map and a published copy of one. If it reports any hit, fix
the map and re-run; **do not publish a map that failed the guardrail check.**

Nothing about publishing relaxes what a map may contain. No commands outside
`## Build & test commands`, no secrets, no file contents — the same rules, now with a wider
audience.

If publishing is unavailable or refused, say so plainly, leave the files on disk, and finish the
run. The maps are the deliverable; the artifacts are a convenience.

## Staleness check

`verify` answers this deterministically: it returns `ageDays` and `stale` per map (default
threshold 14 days, `--max-age` to change it), plus `emptyMaps` for maps that cite nothing at all.
A map is also stale if a spot-check fails — `Glob` the first three entries of its `## Structure`
section and the target of the first `## Search hints` line.

One cheap `Glob` batch decides this. **Never re-walk the tree "to make sure."**

## Common mistakes

- Inferring architecture from directory names when the repo has a `CLAUDE.md` or `ONBOARDING.md`
  that says otherwise. Read `projectDocs` first, every time.
- Starting a run without reading the existing search-hints ledger.
- Re-walking the tree with `Glob`/`Grep` instead of running `map.mjs scan` first.
- Omitting the `Generated:` sha, which silently breaks `--update`.
- Naming domains after layers (`services`, `controllers`) instead of features.
- Citing paths outside backticks, or with the wrong case.
- Dumping code, function bodies, or config contents into a map.
- Writing a mermaid diagram for a two-step flow.
- Describing a flow without enumerating its side effects.
- Finishing without running `verify`, or without updating the ledger.
- Regenerating every map on `--update` when the script named one.
- Finishing a build without publishing the maps, or publishing on `--verify`.
- Publishing without `url` on a rebuild — that creates a duplicate artifact and strands the link
  people already have.
- Converting a map to HTML to publish it, forking it from the file on disk.
- Publishing before `verify` has passed, so a guardrail hit ships to an external service.
- Passing `favicon` on a redeploy, which changes the tab icon people navigate by.
- Forgetting to write the new URLs back into `## Published artifacts`.

## Tests

`node run-tests.mjs` in this directory. 120 tests, no dependencies, Node 14.8+.

## Next step

Once the maps exist, `/plan-feature` reads them to design a change. Name it; do not invoke it.
