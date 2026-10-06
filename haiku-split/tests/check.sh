#!/usr/bin/env bash
# Structural check for the haiku-split skill. Usage: bash check.sh [skill-dir]
set -u
DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
need_file() { [ -f "$DIR/$1" ] || fail "missing file $1"; }
need_str() { grep -qF -- "$2" "$DIR/$1" 2>/dev/null || fail "$1 lacks: $2"; }

for f in SKILL.md templates/TASKS.md templates/handoff.md templates/hard-rules.md templates/workflow.js.tmpl; do
  need_file "$f"
done

# Frontmatter
need_str SKILL.md "name: haiku-split"
need_str SKILL.md "description:"
need_str SKILL.md "claude-haiku-4-5-20251001"
need_str SKILL.md "Confirm"
need_str SKILL.md "classify"

# Script template: model pinned, constants, barrier procedure, no forbidden APIs
T=templates/workflow.js.tmpl
need_str $T "claude-haiku-4-5-20251001"
for s in "{{LIMIT}}" "{{MAX_SEGMENTS}}" "{{AREA}}" "{{RUN_DIR}}" "{{PARAMS}}" "{{HARD_RULES}}" \
         startCounter endCounter handoffPath avenuesCovered avenuesRemaining left_area blocked handoff \
         "args.startSegment" "export const meta"; do
  need_str $T "$s"
done
if grep -qE 'Date\.now|Math\.random|new Date\(\)' "$DIR/$T" 2>/dev/null; then fail "$T uses a forbidden API"; fi

# Hard rules + handoff + tasks templates
need_str templates/hard-rules.md "No outbound email"
need_str templates/hard-rules.md "blocked"
for s in "Done" "Remains" "state" "Gotchas" "Side effects" "Findings"; do need_str templates/handoff.md "$s"; done
for s in "Depends on" "Done-check" "Source step" "Est tokens"; do need_str templates/TASKS.md "$s"; done

# Rendered script must parse as JS (wrapped, because the script body uses top-level return)
if [ -f "$DIR/$T" ]; then
  TMP="$(mktemp -d)"
  sed -e 's/{{LIMIT}}/100000/g' -e 's/{{MAX_SEGMENTS}}/5/g' \
      -e 's/{{AREA}}/"demo"/g' -e 's/{{RUN_DIR}}/"\/tmp\/run"/g' \
      -e 's/{{PARAMS}}/"none"/g' -e 's/{{HARD_RULES}}/"- rule"/g' \
      "$DIR/$T" | sed 's/^export const meta/const meta/' > "$TMP/body.js"
  { echo "(async () => {"; cat "$TMP/body.js"; echo "})()"; } > "$TMP/wrapped.js"
  node --check "$TMP/wrapped.js" 2>"$TMP/err" || { fail "rendered workflow.js does not parse"; cat "$TMP/err"; }
  rm -rf "$TMP"
fi

[ "$FAIL" -eq 0 ] && echo "OK: haiku-split structure valid" && exit 0
exit 1
