#!/usr/bin/env bash
# eval-baseline-save — persist the current test-result state as the
# baseline for a given scope-hash.
#
# Workflow (evaluator calls this AFTER running scoped tests on the
# BASE branch tip):
#
#   git fetch origin && git checkout <base-sha>
#   docker compose down -v && docker compose up -d --build
#   ./scripts/wait-for-healthy.sh
#   # Run the same scopes the PR will be tested against:
#   GATE_SCOPES="web-feed api-articles" ./tests/run-scoped.sh
#   bash scripts/eval-baseline-save.sh --scope-hash <hash> \
#     [--full]
#
# The script reads the same three report locations eval-merge-gate.sh
# reads and writes a single tests/baseline-cache/<hash>.json with
# failing-test identifiers per suite. TTL is time-based (file mtime);
# eval-merge-gate.sh accepts up to HARNESS_GATE_BASELINE_TTL old.

set -uo pipefail

SCOPE_HASH=""
FULL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope-hash) SCOPE_HASH="$2"; shift 2 ;;
    --full) FULL=1; shift ;;
    *) echo "eval-baseline-save: unknown arg: $1" >&2; exit 2 ;;
  esac
done

(( FULL == 1 )) && SCOPE_HASH="FULL"
[[ -z "$SCOPE_HASH" ]] && { echo "eval-baseline-save: --scope-hash required (or --full)" >&2; exit 2; }

mkdir -p tests/baseline-cache 2>/dev/null || exit 1
OUT="tests/baseline-cache/${SCOPE_HASH}.json"

HERE="$(cd "$(dirname "$0")" && pwd)"

extract_playwright() {
  local f
  f=$(find tests/e2e/test-results -type f -name 'summary.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | awk '{print $2}')
  [[ -z "$f" ]] && f=$(find tests/e2e/test-results -type f -name 'results.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | awk '{print $2}')
  [[ -z "$f" || ! -f "$f" ]] && { echo '[]'; return; }
  jq -c '[
    .suites? // [] | recurse(.suites? // empty) | .specs? // [] | .[]
    | select(.tests[]? | .results[]? | .status == "failed" or .status == "unexpected")
    | "\(.file // "?")::\(.title // "?")"
  ] | unique' "$f" 2>/dev/null || echo '[]'
}

extract_newman() {
  local f="tests/api/results/latest"
  [[ -L "$f" ]] && f=$(readlink -f "$f")
  [[ -f "$f" ]] || { echo '[]'; return; }
  python3 -c "
import sys, xml.etree.ElementTree as ET, json
out = []
try:
    for tc in ET.parse('$f').getroot().iter('testcase'):
        if list(tc.iter('failure')) or list(tc.iter('error')):
            out.append(f\"{tc.get('classname', '?')}::{tc.get('name', '?')}\")
except Exception: pass
print(json.dumps(sorted(set(out))))
"
}

extract_uat() {
  local f="tests/uat/results/latest/uat-run.summary.json"
  [[ -f "$f" ]] || { echo '[]'; return; }
  jq -c '[
    .personas? // [] | .[]
    | select(.status == "failed")
    | "uat::\(.name // "?")"
  ] | unique' "$f" 2>/dev/null || echo '[]'
}

pw=$(extract_playwright)
nm=$(extract_newman)
ut=$(extract_uat)

base_sha=$(git rev-parse HEAD 2>/dev/null || echo unknown)
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

jq -n \
  --arg ts "$now_iso" \
  --arg sha "$base_sha" \
  --arg hash "$SCOPE_HASH" \
  --argjson pw "$pw" \
  --argjson nm "$nm" \
  --argjson ut "$ut" \
  '{
    saved_at: $ts,
    base_sha: $sha,
    scope_hash: $hash,
    playwright_fails: $pw,
    newman_fails: $nm,
    uat_fails: $ut
  }' > "$OUT"

echo "baseline saved: $OUT"
echo "  playwright fails: $(echo "$pw" | jq 'length')"
echo "  newman fails:     $(echo "$nm" | jq 'length')"
echo "  uat fails:        $(echo "$ut" | jq 'length')"
