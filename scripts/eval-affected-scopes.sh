#!/usr/bin/env bash
# eval-affected-scopes — which test scopes does this PR actually touch?
#
# Usage:
#   bash scripts/eval-affected-scopes.sh --pr <N> [--base latest] [--format shell|json]
#
# Output (shell, default):
#   SCOPES="web-feed api-articles"
#   FULL=0
#   FULL_REASON=""
#
# Output (json):
#   {"scopes": ["web-feed"], "full": 0, "full_reason": ""}
#
# Map file: tests/affected-map.yaml (project-defined). Schema:
#
#   full_triggers:
#     - "packages/shared/**"
#     - "docker-compose.yml"
#     - "*.lock"
#     - "package.json"
#   scopes:
#     web-feed:
#       files: ["apps/web/app/(feed)/**"]
#       specs: ["tests/e2e/specs/feed*.spec.ts"]
#       newman: ["tests/api/collections/feed.postman_collection.json"]
#       uat:    ["tests/uat/specs/browse*.uat.ts"]
#
# Behavior:
#   - Any changed file matching a full_triggers glob → FULL=1
#   - Otherwise, union of scopes whose files glob matches any
#     changed file
#   - No scope matches, no trigger fires → FULL=1 (conservative)
#   - No tests/affected-map.yaml → FULL=1 ("not opted in")
#   - gh pr diff fails → FULL=1
#
# Fallback glob matcher (no pyyaml dependency). If pyyaml is
# present the parser uses it; otherwise the minimal parser
# handles the schema above.

set -uo pipefail

PR=""
BASE="latest"
FORMAT="shell"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --format) FORMAT="$2"; shift 2 ;;
    *) echo "eval-affected-scopes: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$PR" ]] && { echo "eval-affected-scopes: --pr required" >&2; exit 2; }

emit() {
  local scopes="$1" full="$2" reason="$3"
  if [[ "$FORMAT" == "json" ]]; then
    jq -nc --arg s "$scopes" --argjson f "$full" --arg r "$reason" \
      '{scopes: ($s | split(" ") | map(select(length>0))), full: $f, full_reason: $r}'
  else
    printf 'SCOPES=%q\nFULL=%d\nFULL_REASON=%q\n' "$scopes" "$full" "$reason"
  fi
}

# 1. Get changed files.
if ! files=$(gh pr diff "$PR" --name-only 2>/dev/null); then
  emit "" 1 "gh pr diff failed; fall back to full"
  exit 0
fi
[[ -z "$files" ]] && { emit "" 0 ""; exit 0; }

MAP="tests/affected-map.yaml"
if [[ ! -f "$MAP" ]]; then
  emit "" 1 "no affected-map; project has not opted into scoping"
  exit 0
fi

# Invoke the python helper with changed files on stdin.
HELPER="$(cd "$(dirname "$0")" && pwd)/eval-affected-scopes.py"
if [[ ! -f "$HELPER" ]]; then
  emit "" 1 "helper eval-affected-scopes.py missing"
  exit 0
fi

out=$(printf '%s\n' "$files" | python3 "$HELPER" "$MAP" 2>/dev/null || echo 'FULL=1
FULL_REASON=helper crashed
SCOPES=')

# The helper already produces FULL=.../FULL_REASON=.../SCOPES=...
# If --format=json convert.
if [[ "$FORMAT" == "json" ]]; then
  scopes=$(echo "$out" | grep -E '^SCOPES=' | sed 's/^SCOPES=//')
  full=$(echo "$out" | grep -E '^FULL=' | sed 's/^FULL=//' | head -1)
  reason=$(echo "$out" | grep -E '^FULL_REASON=' | sed 's/^FULL_REASON=//')
  emit "$scopes" "${full:-1}" "$reason"
else
  echo "$out"
fi
