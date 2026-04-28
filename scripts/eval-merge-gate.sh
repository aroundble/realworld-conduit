#!/usr/bin/env bash
# eval-merge-gate — structural enforcement of evaluator's merge gate.
#
# v0.2.39 redesign: scope-aware + baseline triage.
#
# Prior behavior (v0.2.35-v0.2.38): runs the full E2E + Newman +
# UAT suite for every PR, requires failed==0. That produced two
# bottlenecks:
#
#   1. Every PR pays ~3-4 min of full-stack reboot + full-matrix
#      test time. 7 queued PRs → 25+ minutes per evaluator wake.
#   2. If `latest` carries a regression (e.g. failing 14 of 33
#      specs), EVERY new PR inherits those failures and is merge-
#      blocked even though the PR itself is correct. Observed
#      2026-04-28 04:20Z on vibe-studio: 16 PRs stuck on a
#      pre-existing regression unrelated to any of them.
#
# v0.2.39 fixes both by:
#
#   (A) Running only the scopes affected by the PR diff. Scopes
#       are defined in tests/affected-map.yaml (project-owned).
#       Shared-file touches (lock, shared package, compose)
#       trigger FULL. Without a map the gate falls back to FULL.
#       See scripts/eval-affected-scopes.sh + .py.
#
#   (B) Baseline triage. Before running tests on the PR branch,
#       run the same affected-scope tests on the base branch
#       (latest) to establish a baseline failure set. Then run
#       on the PR. A merge passes if the PR's failing tests are
#       a SUBSET of the baseline's failing tests — the PR does
#       not introduce NEW failures. Baseline failures that
#       remain are reported as a regression-tracking issue
#       instead of blocking this PR.
#
#   (C) Baseline cache. Keyed by (base SHA, scope-hash), stored
#       at tests/baseline-cache/<key>.json with TTL 1h. If the
#       same scope has been run recently on the same base SHA,
#       reuse. Eliminates double-cost for same-scope PRs.
#
# The user's intent ("영향은 안 받아야 할 거 같아") is satisfied
# both ways: (a) unrelated scope changes don't cost time; (b) a
# PR isn't blocked by regressions it didn't cause.
#
# Usage:
#   bash scripts/eval-merge-gate.sh --pr <N> --issue <I> \
#       --comment-file /tmp/merge.md [--base latest] \
#       [--scopes "web-feed api-articles"] [--full]
#
# --scopes / --full override the affected-scope auto-detection.
# --full runs everything. Project-maintained `tests/affected-map.yaml`
# is the normal path.

set -uo pipefail

PR=""
ISSUE=""
COMMENT_FILE=""
BASE="latest"
EXPLICIT_SCOPES=""
EXPLICIT_FULL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR="$2"; shift 2 ;;
    --issue) ISSUE="$2"; shift 2 ;;
    --comment-file) COMMENT_FILE="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --scopes) EXPLICIT_SCOPES="$2"; shift 2 ;;
    --full) EXPLICIT_FULL=1; shift ;;
    *) echo "eval-merge-gate: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$PR" ]] && { echo "eval-merge-gate: --pr required" >&2; exit 2; }

min_screenshots="${HARNESS_GATE_MIN_SCREENSHOTS:-1}"
report_max_age="${HARNESS_GATE_REPORT_MAX_AGE:-1800}"
skip_compose="${HARNESS_GATE_SKIP_COMPOSE:-0}"
skip_api="${HARNESS_GATE_SKIP_API:-0}"
skip_uat="${HARNESS_GATE_SKIP_UAT:-0}"
baseline_ttl="${HARNESS_GATE_BASELINE_TTL:-3600}"

HERE="$(cd "$(dirname "$0")" && pwd)"
fail_reasons=()
pass_count=0
gate_total=7

banner() { printf "\n--- %s ---\n" "$*"; }
check_pass() { pass_count=$((pass_count + 1)); printf "  ✓ %s\n" "$*"; }
check_fail() { fail_reasons+=("$*"); printf "  ✗ %s\n" "$*"; }

# Gate 0: resolve affected scopes.
banner "gate 0/7: affected-scope discovery"
SCOPES=""
FULL=0
FULL_REASON=""
if (( EXPLICIT_FULL )); then
  FULL=1
  FULL_REASON="operator-specified --full"
  check_pass "explicit --full run"
elif [[ -n "$EXPLICIT_SCOPES" ]]; then
  SCOPES="$EXPLICIT_SCOPES"
  check_pass "operator-specified scopes: $SCOPES"
else
  scope_out=$(bash "$HERE/eval-affected-scopes.sh" --pr "$PR" --base "$BASE" 2>/dev/null || echo 'FULL=1
FULL_REASON=scope discovery failed
SCOPES=')
  SCOPES=$(echo "$scope_out" | grep -E '^SCOPES=' | sed -e 's/^SCOPES=//' -e "s/^'//;s/'$//")
  FULL=$(echo "$scope_out" | grep -E '^FULL=' | sed 's/^FULL=//' | head -1)
  FULL=${FULL:-1}
  FULL_REASON=$(echo "$scope_out" | grep -E '^FULL_REASON=' | sed -e 's/^FULL_REASON=//' -e "s/^'//;s/'$//")
  if (( FULL )); then
    check_pass "FULL run (reason: ${FULL_REASON:-unspecified})"
  else
    check_pass "scoped run: $SCOPES"
  fi
fi

# The affected-scopes are informational here; the downstream project
# script `tests/e2e/run-scoped.sh` (if present) uses them to filter
# Playwright / Newman / UAT runs. Evaluator is responsible for
# invoking that runner with --scopes before invoking this gate.
# We expose them as GATE_SCOPES / GATE_FULL env for the runner.
export GATE_SCOPES="$SCOPES"
export GATE_FULL="$FULL"

# Gate 1: docker compose ps healthy
banner "gate 1/7: docker compose ps (healthy)"
if [[ "$skip_compose" == "1" ]]; then
  check_pass "skip-compose set — doc/harness-only PR"
else
  if ! command -v docker >/dev/null 2>&1; then
    check_fail "docker not installed"
  else
    ps_out=$(docker compose ps --format json 2>/dev/null || true)
    if [[ -z "$ps_out" ]]; then
      check_fail "docker compose ps returned nothing — no services composed"
    else
      healthy=$(echo "$ps_out" | jq -s '[.[] | select(.Health == "healthy")] | length' 2>/dev/null || echo 0)
      running=$(echo "$ps_out" | jq -s '[.[] | select(.State == "running")] | length' 2>/dev/null || echo 0)
      if [[ "$running" -lt 1 ]]; then
        check_fail "no running services"
      elif [[ "$healthy" -lt 1 ]]; then
        check_fail "services running but none (healthy) — healthcheck not wired or failing"
      else
        check_pass "docker compose: $running running, $healthy healthy"
      fi
    fi
  fi
fi

# Helpers for baseline/PR run comparison.
#
# "Report" here = the most-recently-written summary.json under
# tests/e2e/test-results/ (Playwright) plus tests/api/results/latest.xml
# (Newman) plus tests/uat/results/latest/uat-run.summary.json (UAT).
#
# We do NOT run the suites here — the evaluator runs them before
# invoking the gate. What we do is COMPARE failed-test-identifier
# sets between baseline and PR. Baseline is expected at
# tests/baseline-cache/<scope-hash>.json (written by the evaluator
# after checking out `latest` + running the same scopes).

scope_hash() {
  if (( FULL )); then
    echo "FULL"
  else
    echo -n "$SCOPES" | tr ' ' '\n' | sort | tr '\n' ' ' | md5sum | awk '{print $1}'
  fi
}

baseline_path() {
  echo "tests/baseline-cache/$(scope_hash).json"
}

baseline_age() {
  local f="$1"
  [[ -f "$f" ]] || { echo -1; return; }
  local mt
  mt=$(stat -c %Y "$f" 2>/dev/null || echo 0)
  echo $(( $(date +%s) - mt ))
}

# Extract the set of failed-test identifiers from a Playwright
# JSON-reporter output. Real schema (as of Playwright 1.4x):
#
#   {
#     "stats": {"expected": N, "unexpected": N, "skipped": N, ...},
#     "suites": [
#       {
#         "title": "...", "file": "...",
#         "suites": [ ... recursive ... ],        # nested describe blocks
#         "specs": [
#           {
#             "file": "...", "title": "...",
#             "tests": [
#               {
#                 "status": "expected" | "unexpected" | "flaky",
#                 "results": [{"status": "passed" | "failed" | ...}]
#               }
#             ]
#           }
#         ]
#       }
#     ]
#   }
#
# A spec is FAILED when any test.status == "unexpected" OR when any
# result.status == "failed". Suites nest recursively; we descend via
# `recurse(.suites[]?)` to reach every `.specs[]`.
#
# Identifier: `file::title` is stable across reruns even when line
# numbers shift.
#
# ALSO supports the simpler `summary.json` convention used in
# vibe-studio: a flat record with `{total, passed, failed, suites:
# [{name, passed, failed}]}`. In that case we emit one failure id
# per failed suite (`summary::<name>`) since we have no spec-level
# granularity.
extract_playwright_fails() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # Detect schema: JSON-reporter has `.stats.unexpected`; summary
  # has `.failed` at top level.
  if jq -e '.stats.unexpected != null' "$f" >/dev/null 2>&1; then
    # JSON-reporter (results.json). Playwright nests suites up to
    # ~7 levels deep. Use `.. | objects | select(.specs?)` to walk
    # every object tree at any depth and filter to those that
    # actually carry spec arrays. Inside each spec, a failure =
    # any test.status unexpected/flaky OR any result.status is
    # failed/timedOut/interrupted.
    jq -r '
      [..
       | objects
       | select(.specs?)
       | .specs[]
       | select(
           (.tests[]? | .status == "unexpected" or .status == "flaky")
           or
           (.tests[]? | .results[]? | .status == "failed" or .status == "timedOut" or .status == "interrupted")
         )
       | "\(.file // "?")::\(.title // "?")"]
      | unique[]
    ' "$f" 2>/dev/null
  elif jq -e '.failed != null and .suites != null' "$f" >/dev/null 2>&1; then
    # summary.json (vibe-studio convention)
    jq -r '.suites[] | select(.failed > 0) | "summary::\(.name)"' "$f" 2>/dev/null | sort -u
  fi
}

extract_newman_fails() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # JUnit XML. <testcase name="..."><failure.../></testcase>
  python3 -c "
import sys, xml.etree.ElementTree as ET
try:
    tree = ET.parse('$f'); root = tree.getroot()
    for tc in root.iter('testcase'):
        if list(tc.iter('failure')) or list(tc.iter('error')):
            name = tc.get('name', '?')
            cls = tc.get('classname', '?')
            print(f'{cls}::{name}')
except Exception:
    pass
" | sort -u
}

extract_uat_fails() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # uat-run.summary.json real schema:
  #   {
  #     "total": N, "passed": N, "failed": N,
  #     "personas": [
  #       {"persona": "<name>", "journey": "...", "status": "passed" | "failed",
  #        "steps": [...]}
  #     ]
  #   }
  jq -r '
    .personas? // [] | .[]
    | select(.status == "failed")
    | "uat::\(.persona // .name // "?")"
  ' "$f" 2>/dev/null | sort -u
}

# Gate 2: baseline triage
banner "gate 2/7: baseline triage (PR must not introduce NEW failures)"
mkdir -p tests/baseline-cache 2>/dev/null || true
baseline_file=$(baseline_path)
baseline_age_s=$(baseline_age "$baseline_file")
if (( baseline_age_s < 0 )) || (( baseline_age_s > baseline_ttl )); then
  if (( baseline_age_s < 0 )); then
    check_fail "no baseline cached for scope-hash $(scope_hash) at $baseline_file — evaluator must run \`$BASE\` tip tests against these scopes and save $baseline_file first"
  else
    check_fail "baseline stale (${baseline_age_s}s > ${baseline_ttl}s TTL) at $baseline_file — re-run baseline on \`$BASE\` tip"
  fi
else
  check_pass "baseline fresh (${baseline_age_s}s old): $baseline_file"
fi

# Whether or not baseline is fresh, we still proceed to extract PR
# current-state fails and compare (if baseline available).

# Gate 3: E2E report fresh
banner "gate 3/7: E2E report fresh + new-fails diff"
report_root="tests/e2e/test-results"
if [[ ! -d "$report_root" ]]; then
  check_fail "no tests/e2e/test-results/ directory"
else
  latest=$(find "$report_root" -type f -name 'summary.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1)
  [[ -z "$latest" ]] && latest=$(find "$report_root" -type f -name 'results.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1)
  if [[ -z "$latest" ]]; then
    check_fail "no E2E summary/results file found under $report_root"
  else
    ts=${latest%% *}; path=${latest#* }
    now=$(date +%s); age=$(( now - ${ts%.*} ))
    if (( age > report_max_age )); then
      check_fail "E2E report stale (${age}s > ${report_max_age}s): $path"
    else
      # Diff PR fails vs baseline fails.
      pr_fails=$(mktemp); baseline_fails=$(mktemp)
      extract_playwright_fails "$path" > "$pr_fails"
      if [[ -f "$baseline_file" ]]; then
        jq -r '.playwright_fails[]? // empty' "$baseline_file" 2>/dev/null | sort -u > "$baseline_fails"
      fi
      # NEW = in PR but not in baseline.
      new_fails=$(comm -23 "$pr_fails" "$baseline_fails")
      pr_fail_count=$(wc -l < "$pr_fails")
      new_count=$(echo -n "$new_fails" | grep -c . 2>/dev/null || echo 0)
      baseline_count=$(wc -l < "$baseline_fails")
      if [[ "$new_count" -gt 0 ]]; then
        check_fail "E2E: $new_count NEW failure(s) introduced by this PR (baseline had $baseline_count, PR has $pr_fail_count)"
        echo "     New failures (introduced by PR):"
        echo "$new_fails" | head -10 | sed 's/^/       - /'
      else
        check_pass "E2E: $pr_fail_count fails (all ⊆ baseline's $baseline_count; 0 new)"
      fi
      rm -f "$pr_fails" "$baseline_fails"
    fi
  fi
fi

# Gate 4: screenshots
banner "gate 4/7: screenshots present (≥ ${min_screenshots})"
if [[ -n "$ISSUE" ]]; then
  shot_dir="tests/e2e/screenshots/$ISSUE"
  if [[ ! -d "$shot_dir" ]]; then
    check_fail "no screenshots/$ISSUE/ directory"
  else
    count=$(find "$shot_dir" -type f \( -name '*.png' -o -name '*.jpg' \) | wc -l)
    if (( count < min_screenshots )); then
      check_fail "screenshots/$ISSUE/ has $count files; need $min_screenshots"
    else
      check_pass "$count screenshot(s) for issue #$ISSUE"
    fi
  fi
else
  count=$(find tests/e2e/screenshots -type f \( -name '*.png' -o -name '*.jpg' \) -mmin -60 2>/dev/null | wc -l)
  if (( count < min_screenshots )); then
    check_fail "no recent screenshots; pass --issue <N>"
  else
    check_pass "$count recent screenshot(s)"
  fi
fi

# Gate 5: merge comment
banner "gate 5/7: merge comment has evidence sections"
if [[ -z "$COMMENT_FILE" || ! -f "$COMMENT_FILE" ]]; then
  check_fail "--comment-file not provided or missing"
else
  missing=()
  grep -qiE 'docker compose ps|compose ps|services.*healthy' "$COMMENT_FILE" || missing+=("docker compose ps block")
  grep -qiE 'playwright|newman|e2e|scenarios? (passed|green)' "$COMMENT_FILE" || missing+=("E2E/Playwright/Newman output")
  grep -qiE 'screenshot|\.png|\.jpg' "$COMMENT_FILE" || missing+=("screenshot reference")
  grep -qiE 'scope|baseline|new failures|fail.*⊆' "$COMMENT_FILE" || missing+=("scope+baseline summary")
  if (( ${#missing[@]} > 0 )); then
    check_fail "merge comment missing sections: ${missing[*]}"
  else
    check_pass "merge comment contains all required evidence sections"
  fi
fi

# Gate 6: Newman API tests
banner "gate 6/7: Newman API fresh + 0 new-fails vs baseline"
if [[ "$skip_api" == "1" ]]; then
  check_pass "skip-api set"
else
  newman_latest="tests/api/results/latest"
  if [[ ! -L "$newman_latest" && ! -f "$newman_latest" ]]; then
    check_fail "no tests/api/results/latest — Newman never ran"
  else
    real=$([[ -L "$newman_latest" ]] && readlink -f "$newman_latest" || echo "$newman_latest")
    age=$(( $(date +%s) - $(stat -c %Y "$real" 2>/dev/null || echo 0) ))
    if (( age > report_max_age )); then
      check_fail "Newman report stale (${age}s > ${report_max_age}s)"
    else
      pr_api_fails=$(mktemp); baseline_api_fails=$(mktemp)
      extract_newman_fails "$real" > "$pr_api_fails"
      if [[ -f "$baseline_file" ]]; then
        jq -r '.newman_fails[]? // empty' "$baseline_file" 2>/dev/null | sort -u > "$baseline_api_fails"
      fi
      new_api=$(comm -23 "$pr_api_fails" "$baseline_api_fails")
      new_api_n=$(echo -n "$new_api" | grep -c . 2>/dev/null || echo 0)
      pr_api_n=$(wc -l < "$pr_api_fails")
      base_api_n=$(wc -l < "$baseline_api_fails")
      if (( new_api_n > 0 )); then
        check_fail "Newman: $new_api_n NEW failure(s) from PR (baseline $base_api_n / PR $pr_api_n)"
        echo "$new_api" | head -10 | sed 's/^/       - /'
      else
        check_pass "Newman: $pr_api_n fails ⊆ baseline $base_api_n (0 new)"
      fi
      rm -f "$pr_api_fails" "$baseline_api_fails"
    fi
  fi
fi

# Gate 7: UAT
banner "gate 7/7: UAT personas fresh + 0 new-fails vs baseline"
if [[ "$skip_uat" == "1" ]]; then
  check_pass "skip-uat set"
else
  uat_latest="tests/uat/results/latest"
  if [[ ! -L "$uat_latest" && ! -d "$uat_latest" ]]; then
    check_fail "no tests/uat/results/latest — UAT never ran"
  else
    summary="$uat_latest/uat-run.summary.json"
    if [[ ! -f "$summary" ]]; then
      check_fail "no uat-run.summary.json"
    else
      pr_uat=$(mktemp); base_uat=$(mktemp)
      extract_uat_fails "$summary" > "$pr_uat"
      if [[ -f "$baseline_file" ]]; then
        jq -r '.uat_fails[]? // empty' "$baseline_file" 2>/dev/null | sort -u > "$base_uat"
      fi
      new_uat=$(comm -23 "$pr_uat" "$base_uat")
      new_n=$(echo -n "$new_uat" | grep -c . 2>/dev/null || echo 0)
      if (( new_n > 0 )); then
        check_fail "UAT: $new_n NEW persona failure(s)"
        echo "$new_uat" | sed 's/^/       - /'
      else
        check_pass "UAT: fails ⊆ baseline (0 new)"
      fi
      rm -f "$pr_uat" "$base_uat"
    fi
  fi
fi

banner "gate summary"
echo "  Passed: $pass_count / $gate_total gates"
echo "  Failed: ${#fail_reasons[@]}"
if (( ${#fail_reasons[@]} > 0 )); then
  echo ""
  echo "MERGE BLOCKED. Reasons:"
  for r in "${fail_reasons[@]}"; do
    echo "  - $r"
  done
  echo ""
  echo "Actions:"
  echo "  - Fix missing evidence (compose-up, re-run scoped tests"
  echo "    per affected-scopes, re-capture screenshots)."
  echo "  - If baseline missing/stale: check out $BASE tip, run the"
  echo "    same scopes, save failing-test identifiers to"
  echo "    $baseline_file (schema: {playwright_fails: [...], newman_fails: [...], uat_fails: [...]})."
  echo "  - If NEW failures are in the PR: swap PR to claim:generator"
  echo "    with ## 수정 요청 citing the new failures."
  echo "  - Do NOT merge by bypassing this gate."
  exit 1
fi

echo ""
echo "All gates passed."
echo "Scopes run: ${SCOPES:-FULL ($FULL_REASON)}"
echo "Evaluator may proceed:"
echo "  gh pr merge $PR --merge --delete-branch --body-file $COMMENT_FILE"
exit 0
