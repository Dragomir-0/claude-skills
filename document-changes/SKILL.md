---
name: document-changes
description: >
  Read code changes and generate comprehensive change documentation with ticket context.
  Analyzes git diff, maps impact across architecture layers, documents rationale and design decisions.
  Creates structured markdown docs that explain the "why" behind every change.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion
---

# document-changes

## Overview

Automates the creation of change documentation for Reading Rocket Reborn. When you complete a feature, bugfix, or refactor, this skill reads your code changes and generates a comprehensive markdown document that explains:

- **What changed** — which files and layers affected
- **Why it changed** — the problem it solves, the requirement it meets
- **How it changed** — architecture impact, design decisions, trade-offs
- **FSD alignment** — how this fits Feature-Sliced Design principles

**Documentation location:** `../Reading Rocket Reborn Docs/changes/`

**Usage:**
```
/document-changes --ticket RR-001 --title "Student Entity Refactor" --reason "Implement FSD structure with proper layer separation"
```

Or with short flags:
```
/document-changes -t RR-001 -T "Student Entity Refactor" -r "FSD structure"
```

**Output:** `../Reading Rocket Reborn Docs/changes/[TICKET-ID]-[slug].md`

## Parameters

| Flag | Long Form | Required | Example | Notes |
|------|-----------|----------|---------|-------|
| `-t` | `--ticket` | ✅ Yes | `RR-001` | Ticket/issue ID for tracking |
| `-T` | `--title` | ✅ Yes | `Student Entity Refactor` | One-line description of what was done |
| `-r` | `--reason` | ✅ Yes | `Need proper FSD structure` | Why this change matters (problem/requirement) |
| `-d` | `--diff-path` | ❌ Optional | Custom git diff file path | If you have a pre-captured diff |

If required parameters are missing, the skill will ask you for them.

## Workflow

1. **Make your code changes** — implement the feature/fix
2. **Stage or commit** — `git add .` or `git commit`
3. **Run the skill** — `/document-changes -t RR-001 -T "My Feature" -r "Why I needed this"`
4. **Review the generated doc** — at `docs/changes/RR-001-my-feature.md`
5. **Refine if needed** — ask the skill for clarifications or corrections
6. **Commit together** — both code and documentation in one commit

## What Gets Generated

The skill creates a markdown document (from template at `../Reading Rocket Reborn Docs/changes/TEMPLATE.md`) with:

### Required Sections
- ✅ **Ticket reference** — ID, title, date, author
- ✅ **Context** — why this change was needed
- ✅ **Files Modified** — all changed files organized by layer
- ✅ **Architecture Impact** — impact on each layer:
  - Domain Layer (entities, aggregates, business rules)
  - Application Layer (commands, queries, handlers)
  - Persistence/Infrastructure Layer (data access, services)
  - API Layer (controllers, endpoints)
  - Web Layer (Blazor components, pages)
  - Shared Layer (DTOs, contracts)
- ✅ **Key Changes** — important implementation details (before/after if applicable)
- ✅ **Design Decisions** — why this approach, trade-offs, constraints
- ✅ **FSD Alignment** — how this aligns with Feature-Sliced Design
- ✅ **Related Documentation** — links to related tickets/docs

### Optional Sections
- Testing considerations
- Follow-up tasks
- Performance notes

## How It Works

### Step 1 — Git Analysis
The skill:
1. Reads `git diff` to see all staged/uncommitted changes
2. Identifies which files changed and what kind of change (create/modify/delete)
3. Maps files to architecture layers based on their paths

### Step 2 — Layer Mapping
Maps files like:
- `src/ReadingRocket.Domain/**` → Domain Layer
- `src/ReadingRocket.Application/**` → Application Layer
- `src/ReadingRocket.Persistence/**` → Persistence/Infrastructure
- `src/ReadingRocket.Api/**` → API Layer
- `src/ReadingRocket.Web/**` → Web Layer
- `src/ReadingRocket.Shared/**` → Shared Layer

### Step 3 — Content Analysis
For each layer, the skill:
1. Reads the modified files (to understand what changed)
2. Identifies key code changes
3. Infers the purpose from context
4. Asks you clarifying questions if the change is ambiguous

### Step 4 — Documentation Generation
Generates markdown with:
- Your provided context (ticket, title, reason)
- Automated analysis (files, layers, changes)
- Your input on design decisions
- Links and next steps

### Step 5 — Output
Writes the complete document to:
```
../Reading Rocket Reborn Docs/changes/[TICKET-ID]-[slug].md
```

Where `[slug]` is a URL-friendly version of the title (e.g., `student-entity-refactor`).

## Examples

### Example 1 — Simple Bugfix

```bash
/document-changes \
  -t RR-002 \
  -T "Fix validation behavior" \
  -r "Validation wasn't firing on all CQRS handlers, causing invalid data to persist"
```

**Generated:** `../Reading Rocket Reborn Docs/changes/RR-002-fix-validation-behavior.md`

**Includes:**
- Problem statement (validation gaps)
- Files changed (ValidationBehavior, affected handlers)
- Layers touched (Application, Persistence impact)
- How validation works now
- Why this approach was chosen

### Example 2 — Feature Implementation

```bash
/document-changes \
  -t RR-003 \
  -T "Add student bulk import" \
  -r "Need to import multiple students from CSV to support enrollment at scale"
```

**Generated:** `../Reading Rocket Reborn Docs/changes/RR-003-add-student-bulk-import.md`

**Includes:**
- Business requirement (enrollment at scale)
- Files created/modified (API endpoint, import command, repository, etc.)
- All layers affected (API → Application → Persistence → Domain)
- Design decisions (streaming vs. batch, error handling, validation)
- Performance considerations
- FSD feature alignment

### Example 3 — Refactor

```bash
/document-changes \
  -t RR-004 \
  -T "Implement repository pattern" \
  -r "Need abstraction layer for data access to enable testing and future database switches"
```

**Generated:** `../Reading Rocket Reborn Docs/changes/RR-004-implement-repository-pattern.md`

**Includes:**
- Architectural reason (testability, flexibility)
- Interface definitions
- Implementation classes
- Where repositories are injected
- Testing benefits gained
- FSD alignment (domain abstraction)

## Questions the Skill Might Ask

During generation, the skill may ask:

1. **On design decisions:**
   > "I see you added a new command handler. Why not add this logic to an existing handler? What's the business reason for a new one?"

2. **On trade-offs:**
   > "This change touches persistence and application layers. Did you consider doing this in the Domain layer instead? Why the choice you made?"

3. **On impact:**
   > "You modified the Student entity signature. Will existing code still compile? Do you need migration steps or updates elsewhere?"

4. **On FSD:**
   > "This looks like it could belong in a 'students' feature slice. Is that how you're organizing it?"

Answer these truthfully — they help create better documentation.

## Output Format

```
# RR-001 - Student Entity Refactor

**Ticket:** RR-001  
**Title:** Student Entity Refactor  
**Date:** 2026-09-15  
**Author:** Hermann Roets  

## Context
Why was this change needed...

## Changes
### Files Modified
- **Domain** `src/ReadingRocket.Domain/Entities/Student.cs` — Added properties for FSD alignment...
- **Application** `src/ReadingRocket.Application/Students/Commands/CreateStudent.cs` — Updated to use new entity...
- [etc.]

### Architecture Impact
#### Domain Layer
- Added FirstName, LastName properties
- Refactored validation rules into domain

#### Application Layer
- Updated CreateStudent command
- Modified handlers to use new structure

[... other layers ...]

## Key Changes
- Before: `public class Student { public string Name { get; set; } }`
- After: `public class Student { public string FirstName { get; set; } public string LastName { get; set; } }`

## Design Decisions
1. **Separated name into FirstName/LastName** — Better matches real-world use cases for filtering/reporting
2. **Kept validation in domain** — Business rules live in domain layer, not application

## FSD Alignment
This change implements the "students" feature slice with proper domain layer abstraction.

## Related Documentation
- Related to RR-000: Initial project structure
```

## Common Scenarios

### Scenario 1 — Just Fixed a Bug
```bash
/document-changes \
  -t RR-100 \
  -T "Fix null reference in student validation" \
  -r "Validation threw when optional field was null, but code expected non-null"
```

Skill will note:
- Where the bug was
- Why it happened
- How the fix prevents it
- Whether validation rules changed

### Scenario 2 — Added a New Feature
```bash
/document-changes \
  -t RR-101 \
  -T "Add student search by grade level" \
  -r "Teachers need to find all students in a grade to export attendance"
```

Skill will document:
- New query/endpoint added
- Database index changes if any
- UI component changes
- How searching is implemented (filter, SQL where clause, etc.)

### Scenario 3 — Refactored Existing Code
```bash
/document-changes \
  -t RR-102 \
  -T "Extract validation into separate service" \
  -r "Validation logic was duplicated across 4 handlers, needed reusable component"
```

Skill will show:
- Where duplication was
- What was extracted
- How it's now used
- Why this reduces bugs and maintenance

## Tips

1. **Commit first, document after** — run `/document-changes` on clean diffs
2. **Use clear ticket IDs** — makes docs easy to find and reference
3. **Be specific on "why"** — "needed FSD structure" > "refactoring"
4. **Ask clarifying questions** — don't answer vaguely if the skill asks
5. **Review generated docs** — fix any inaccuracies before committing
6. **Keep docs with code** — both in same commit for history

## Constraints

- Requires a git repository
- Needs staged/committed changes to analyze (won't generate from uncommitted work)
- Works best on logical units (one feature or bugfix per run)
- Asks questions when changes are too large/scattered to document clearly

## Next Steps

Once the skill generates documentation:

1. **Read the generated file** at `docs/changes/[TICKET-ID]-[slug].md`
2. **Refine any sections** that don't match your intent
3. **Add follow-up tasks** if you see them
4. **Commit both code and doc** — `git add . && git commit -m "..."`
5. **Push when ready** — documentation goes with the code

## Related

- Template: `../Reading Rocket Reborn Docs/changes/TEMPLATE.md` — format the skill uses
- Guide: `../Reading Rocket Reborn Docs/README.md` — how to maintain change documentation
- Project: `CLAUDE.md` — architecture and project overview
