#!/usr/bin/env bash
# Structural check for the pigeon skill. Usage: bash check.sh [skill-dir]
set -u
DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
need_file() { [ -f "$DIR/$1" ] || fail "missing file $1"; }
need_str() { grep -qF -- "$2" "$DIR/$1" 2>/dev/null || fail "$1 lacks: $2"; }
forbid_str() { grep -qE -- "$2" "$DIR/$1" 2>/dev/null && fail "$1 must not contain: $2"; }

for f in SKILL.md templates/handoff.md templates/RUN_LOG.md \
         personas/01-task-researcher.md personas/02-business-aligner.md \
         personas/03-ui-designer.md personas/04-software-developer.md \
         personas/05-test-engineer.md personas/06-cybersecurity-expert.md \
         personas/07-refactor-developer.md personas/08-infrastructure-specialist.md \
         personas/09-release-notes-writer.md personas/10-ship.md; do
  need_file "$f"
done

# Frontmatter
need_str SKILL.md "name: pigeon"
need_str SKILL.md "description:"
need_str SKILL.md "Triggered by /pigeon."
need_str SKILL.md "disable-model-invocation: false"
forbid_str SKILL.md "^model:"

# Persona registry: all 10 exact persona-id tokens must appear
for t in task-researcher business-aligner ui-designer software-developer test-engineer \
         cybersecurity-expert refactor-developer infrastructure-specialist \
         release-notes-writer ship; do
  need_str SKILL.md "$t"
done

# Routing / pacing mechanics
for s in "Next" "personas/" "--resume" "backward" "bounce cap" "pipeline-contract.md" \
         "none — run complete"; do
  need_str SKILL.md "$s"
done

# Templates
for s in "From:" "To:" "Direction:" "Timestamp:" "## Context carried forward" "## Next" \
         "Persona:" "Reason:" "none — run complete"; do
  need_str templates/handoff.md "$s"
done
need_str templates/RUN_LOG.md "| Hop | Persona | Direction | Next | Reason |"

# Each persona wraps the right existing skill, or carries its own required marker
need_str personas/01-task-researcher.md ".gitignore"
need_str personas/02-business-aligner.md "plan-feature"
need_str personas/03-ui-designer.md "software-developer"
need_str personas/04-software-developer.md "execute-plan"
need_str personas/05-test-engineer.md "test-feature"
need_str personas/05-test-engineer.md "kevin"
need_str personas/05-test-engineer.md "Docker"
need_str personas/06-cybersecurity-expert.md "security-review"
need_str personas/07-refactor-developer.md "simplify"
need_str personas/08-infrastructure-specialist.md "infrastructure"
need_str personas/09-release-notes-writer.md "release notes"
need_str personas/10-ship.md "cleanup-crew"
need_str personas/10-ship.md "RELEASE_NOTES_"

[ "$FAIL" -eq 0 ] && echo "OK: pigeon structure valid" && exit 0
exit 1
