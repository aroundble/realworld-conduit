#!/usr/bin/env bash
# generate-e2e-index — rebuild the test-results index.html cascade.
#
# Reads every tests/e2e/test-results/**/summary.json and writes:
#   tests/e2e/test-results/index.html
#   tests/e2e/test-results/<env>/index.html
#   tests/e2e/test-results/<env>/<yyyymmdd>/index.html
#   tests/e2e/test-results/<env>/<yyyymmdd>/<hhmmss>/index.html
#
# Directory names stay UTC. Rendered times in the HTML respect
# $HARNESS_TZ (default UTC) and append the UTC equivalent in parens.
#
# Usage:
#   scripts/generate-e2e-index.sh [path-to-test-results]
#
# Default path: tests/e2e/test-results/

set -euo pipefail

ROOT="${1:-tests/e2e/test-results}"
TZ_DISPLAY="${HARNESS_TZ:-UTC}"

if [[ ! -d "$ROOT" ]]; then
  echo "test-results root not found: $ROOT" >&2
  exit 1
fi

# Helper: render a UTC ISO timestamp as "<local> (UTCZ)".
# Requires `date` (GNU or BSD) that accepts -d with a TZ env.
render_time() {
  local utc_iso="$1"
  local local_ts
  if ! local_ts=$(TZ="$TZ_DISPLAY" date -d "$utc_iso" '+%Y-%m-%d %H:%M %Z' 2>/dev/null); then
    # BSD date fallback
    local_ts=$(TZ="$TZ_DISPLAY" date -j -f '%Y-%m-%dT%H:%M:%SZ' "$utc_iso" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || echo "$utc_iso")
  fi
  local utc_short
  utc_short=$(echo "$utc_iso" | sed -E 's/T([0-9]{2}):([0-9]{2}).*Z/ \1:\2Z/')
  printf '%s (%s)' "$local_ts" "$utc_short"
}

# Entry: one leaf run directory (<env>/<yyyymmdd>/<hhmmss>/).
# Writes an index.html summarising that run from summary.json.
write_run_index() {
  local dir="$1"
  local summary="$dir/summary.json"
  if [[ ! -f "$summary" ]]; then
    return
  fi
  local env commit_short branch pr_number pr_url started total passed failed report_html
  env=$(jq -r '.env // "?"' "$summary")
  commit_short=$(jq -r '.commit_short // "?"' "$summary")
  branch=$(jq -r '.branch // "?"' "$summary")
  pr_number=$(jq -r '.pr_number // ""' "$summary")
  pr_url=$(jq -r '.pr_url // ""' "$summary")
  started=$(jq -r '.started_at_utc // ""' "$summary")
  total=$(jq -r '.total // 0' "$summary")
  passed=$(jq -r '.passed // 0' "$summary")
  failed=$(jq -r '.failed // 0' "$summary")
  report_html=$(ls -1 "$dir"/*.html 2>/dev/null | grep -v '/index.html$' | head -1 || true)
  report_html=${report_html##*/}

  {
    echo '<!doctype html><meta charset="utf-8">'
    echo "<title>E2E run: ${branch} @ ${commit_short}</title>"
    echo '<style>body{font-family:system-ui;margin:2rem;max-width:800px}table{border-collapse:collapse;width:100%}td,th{padding:4px 8px;border-bottom:1px solid #ddd;text-align:left}</style>'
    echo "<h1>Run: ${branch}</h1>"
    echo "<p><strong>When:</strong> $(render_time "$started")</p>"
    echo "<p><strong>Env:</strong> ${env} &nbsp;·&nbsp; <strong>Commit:</strong> ${commit_short}"
    if [[ -n "$pr_number" && "$pr_number" != "null" ]]; then
      echo " &nbsp;·&nbsp; <strong>PR:</strong> <a href=\"${pr_url}\">#${pr_number}</a>"
    fi
    echo '</p>'
    echo "<p><strong>Total:</strong> ${total} &nbsp; <strong>Passed:</strong> ${passed} &nbsp; <strong>Failed:</strong> ${failed}</p>"
    if [[ -n "$report_html" ]]; then
      echo "<p><a href=\"./${report_html}\">open full report</a></p>"
    fi
    # Suite breakdown
    echo '<h2>Suites</h2><table><tr><th>Suite</th><th>Pass</th><th>Fail</th></tr>'
    jq -r '.suites[]? | "<tr><td>\(.name)</td><td>\(.passed)</td><td>\(.failed)</td></tr>"' "$summary"
    echo '</table>'
  } > "$dir/index.html"
}

# Day-level: <env>/<yyyymmdd>/index.html — links to each hhmmss run.
write_day_index() {
  local day_dir="$1"
  local env_name yyyymmdd
  env_name=$(basename "$(dirname "$day_dir")")
  yyyymmdd=$(basename "$day_dir")
  {
    echo '<!doctype html><meta charset="utf-8">'
    echo "<title>E2E runs ${yyyymmdd} · ${env_name}</title>"
    echo '<style>body{font-family:system-ui;margin:2rem;max-width:800px}ul{list-style:none;padding:0}li{padding:4px 0;border-bottom:1px solid #eee}</style>'
    echo "<h1>${env_name} · ${yyyymmdd}</h1>"
    echo '<ul>'
    # Newest first.
    for run in $(ls -1d "$day_dir"/*/ 2>/dev/null | sort -r); do
      if [[ -f "${run}summary.json" ]]; then
        local t p f branch_slug commit_short pr_number
        t=$(jq -r '.total // 0' "${run}summary.json")
        p=$(jq -r '.passed // 0' "${run}summary.json")
        f=$(jq -r '.failed // 0' "${run}summary.json")
        branch_slug=$(jq -r '.branch_slug // .branch // "?"' "${run}summary.json")
        commit_short=$(jq -r '.commit_short // "?"' "${run}summary.json")
        pr_number=$(jq -r '.pr_number // ""' "${run}summary.json")
        local hhmmss
        hhmmss=$(basename "$run")
        echo -n "<li><a href=\"./${hhmmss}/\">${hhmmss}Z</a> · ${branch_slug} @ ${commit_short}"
        if [[ -n "$pr_number" && "$pr_number" != "null" ]]; then
          echo -n " · PR #${pr_number}"
        fi
        if [[ "$f" == "0" ]]; then
          echo -n " · <strong>PASS</strong> ${p}/${t}</li>"
        else
          echo -n " · <strong>FAIL</strong> ${f}/${t}</li>"
        fi
        echo
      fi
    done
    echo '</ul>'
    echo "<p><a href=\"../\">back to ${env_name}</a></p>"
  } > "$day_dir/index.html"
}

# Env-level: <env>/index.html — list of days.
write_env_index() {
  local env_dir="$1"
  local env_name
  env_name=$(basename "$env_dir")
  {
    echo '<!doctype html><meta charset="utf-8">'
    echo "<title>E2E · ${env_name}</title>"
    echo '<style>body{font-family:system-ui;margin:2rem;max-width:800px}ul{list-style:none;padding:0}li{padding:4px 0}</style>'
    echo "<h1>${env_name}</h1>"
    echo '<ul>'
    for day in $(ls -1d "$env_dir"/*/ 2>/dev/null | sort -r); do
      local day_name run_count
      day_name=$(basename "$day")
      run_count=$(ls -1d "$day"/*/ 2>/dev/null | wc -l | tr -d ' ')
      echo "<li><a href=\"./${day_name}/\">${day_name}</a> · ${run_count} runs</li>"
    done
    echo '</ul>'
    echo '<p><a href="../">back to all envs</a></p>'
  } > "$env_dir/index.html"
}

# Root-level: test-results/index.html — latest per env.
write_root_index() {
  local root="$1"
  {
    echo '<!doctype html><meta charset="utf-8">'
    echo '<title>E2E · all envs</title>'
    echo '<style>body{font-family:system-ui;margin:2rem;max-width:800px}table{border-collapse:collapse;width:100%}td,th{padding:6px 10px;border-bottom:1px solid #ddd;text-align:left}</style>'
    echo '<h1>E2E test results</h1>'
    echo '<table><tr><th>Env</th><th>Latest run</th><th>PR</th><th>Result</th><th>Open</th></tr>'
    for env_dir in $(ls -1d "$root"/*/ 2>/dev/null | sort); do
      local env_name
      env_name=$(basename "$env_dir")
      [[ "$env_name" == "." ]] && continue
      local latest
      latest=$(find "$env_dir" -name summary.json -print0 2>/dev/null | xargs -0 -n1 stat -c '%Y %n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
      if [[ -z "$latest" ]]; then
        echo "<tr><td>${env_name}</td><td colspan=4>no runs yet</td></tr>"
        continue
      fi
      local started commit_short pr_number passed failed total rel_dir
      started=$(jq -r '.started_at_utc // ""' "$latest")
      commit_short=$(jq -r '.commit_short // "?"' "$latest")
      pr_number=$(jq -r '.pr_number // ""' "$latest")
      passed=$(jq -r '.passed // 0' "$latest")
      failed=$(jq -r '.failed // 0' "$latest")
      total=$(jq -r '.total // 0' "$latest")
      rel_dir=$(dirname "$latest" | sed "s|^${root}/||")
      local verdict
      if [[ "$failed" == "0" ]]; then
        verdict="PASS ${passed}/${total}"
      else
        verdict="FAIL ${failed}/${total}"
      fi
      echo -n "<tr><td><a href=\"./${env_name}/\">${env_name}</a></td>"
      echo -n "<td>$(render_time "$started")</td>"
      if [[ -n "$pr_number" && "$pr_number" != "null" ]]; then
        echo -n "<td>#${pr_number}</td>"
      else
        echo -n "<td>—</td>"
      fi
      echo -n "<td><strong>${verdict}</strong> (${commit_short})</td>"
      echo "<td><a href=\"./${rel_dir}/\">open</a></td></tr>"
    done
    echo '</table>'
  } > "$root/index.html"
}

# ─── walk ────────────────────────────────────────────────────────

# 1. write per-run indexes (every dir that has summary.json).
while IFS= read -r -d '' summary; do
  dir=$(dirname "$summary")
  write_run_index "$dir"
done < <(find "$ROOT" -name summary.json -print0 2>/dev/null)

# 2. per-day indexes.
for env_dir in "$ROOT"/*/; do
  [[ -d "$env_dir" ]] || continue
  for day_dir in "$env_dir"*/; do
    [[ -d "$day_dir" ]] || continue
    write_day_index "$day_dir"
  done
done

# 3. per-env indexes.
for env_dir in "$ROOT"/*/; do
  [[ -d "$env_dir" ]] || continue
  write_env_index "$env_dir"
done

# 4. root index.
write_root_index "$ROOT"

echo "index cascade regenerated under: $ROOT"
