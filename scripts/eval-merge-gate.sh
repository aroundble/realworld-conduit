#!/usr/bin/env bash
# eval-merge-gate — structural enforcement of evaluator's Axis 5.
#
# The v0.2.34 prompt told evaluators "score 0 without docker compose
# ps healthy + Playwright BDD + screenshots". The 2026-04-28 hot-deal
# run showed the prompt alone is insufficient — evaluator approved
# 83 PRs with the "live-BDD" section merely *asserted*, not verified.
#
# This script is the structural gate. The evaluator MUST invoke it
# before `gh pr merge`. It:
#   1. Verifies `docker compose ps` shows at least one service
#      Up (healthy).
#   2. Verifies an E2E report exists under
#      tests/e2e/test-results/ newer than the PR's head SHA timestamp.
#   3. Verifies the report's summary.json has passed > 0 and
#      failed == 0.
#   4. Verifies at least one screenshot exists in
#      tests/e2e/screenshots/<issue>/ for the PR's linked issue.
#   5. Verifies the merge comment file contains the required
#      evidence sections.
#
# Exit codes:
#   0 — all checks passed, evaluator may proceed to gh pr merge.
#   1 — a check failed; evaluator must either re-run the stack and
#       re-verify, or swap the PR back to claim:generator.
#
# Usage:
#   bash scripts/eval-merge-gate.sh --pr <N> --issue <I> \
#                                    --comment-file /tmp/merge.md
#
# Seven sequential gates, ALL must pass:
#   1. docker compose ps shows ≥1 service Up (healthy)
#   2. E2E (Playwright) report fresh (< HARNESS_GATE_REPORT_MAX_AGE)
#   3. E2E summary passed > 0, failed == 0
#   4. Screenshots ≥ HARNESS_GATE_MIN_SCREENSHOTS per issue
#   5. Merge comment contains evidence section references
#   6. API test run (Newman / pytest-httpx / curl-checks) fresh +
#      passing — covers HTTP boundary scenarios the UI doesn't
#      exercise. Location: tests/api/results/ or tests/newman/.
#   7. UAT (user-acceptance) run fresh + passing — covers the
#      operator-observable user stories from the issue's BDD AC in
#      a way that mirrors the real user's sequence. Location:
#      tests/uat/results/. UAT is Playwright-driven but scored
#      against user-intent pass/fail rather than individual spec
#      pass/fail.
#
# Env (optional):
#   HARNESS_GATE_MIN_SCREENSHOTS   minimum distinct screenshots required
#                                  (default 1)
#   HARNESS_GATE_REPORT_MAX_AGE    E2E / API / UAT report staleness
#                                  in seconds (default 1800 = 30m)
#   HARNESS_GATE_SKIP_COMPOSE      "1" skips the compose-ps check;
#                                  only valid for doc-only / harness-
#                                  layer PRs. Evaluator must justify
#                                  skip in the merge comment.
#   HARNESS_GATE_SKIP_API          "1" skips API gate — only for
#                                  pure-UI-without-backend PRs.
#   HARNESS_GATE_SKIP_UAT          "1" skips UAT gate — only for
#                                  background-worker / CLI / infra
#                                  PRs that have no user-visible
#                                  surface.
set -uo pipefail

PR=""
ISSUE=""
COMMENT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR="$2"; shift 2 ;;
    --issue) ISSUE="$2"; shift 2 ;;
    --comment-file) COMMENT_FILE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PR" ]]; then
  echo "ERROR: --pr <N> required" >&2
  exit 2
fi

min_screenshots="${HARNESS_GATE_MIN_SCREENSHOTS:-1}"
report_max_age="${HARNESS_GATE_REPORT_MAX_AGE:-1800}"
skip_compose="${HARNESS_GATE_SKIP_COMPOSE:-0}"
skip_api="${HARNESS_GATE_SKIP_API:-0}"
skip_uat="${HARNESS_GATE_SKIP_UAT:-0}"

fail_reasons=()
pass_count=0

banner() {
  printf "\n--- %s ---\n" "$*"
}

check_pass() {
  pass_count=$((pass_count + 1))
  printf "  ✓ %s\n" "$*"
}

check_fail() {
  fail_reasons+=("$*")
  printf "  ✗ %s\n" "$*"
}

# 1. docker compose ps healthy
banner "gate 1/5: docker compose ps (healthy)"
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

# 2. E2E report recency
banner "gate 2/5: E2E report fresh"
report_root="tests/e2e/test-results"
if [[ ! -d "$report_root" ]]; then
  check_fail "no tests/e2e/test-results/ directory"
else
  latest=$(find "$report_root" -type f \( -name "summary.json" -o -name "results.json" -o -name "*.xml" \) -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1)
  if [[ -z "$latest" ]]; then
    check_fail "no E2E summary/result file found under $report_root"
  else
    ts=${latest%% *}
    path=${latest#* }
    now=$(date +%s)
    age=$(( now - ${ts%.*} ))
    if (( age > report_max_age )); then
      check_fail "E2E report stale (${age}s old > ${report_max_age}s cap): $path"
    else
      check_pass "E2E report fresh (${age}s old): $path"
    fi
  fi
fi

# 3. E2E summary passed > 0 / failed == 0
banner "gate 3/5: E2E summary passed>0 failed==0"
summary_file=$(find "$report_root" -type f -name "summary.json" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | awk '{print $2}')
if [[ -z "$summary_file" || ! -f "$summary_file" ]]; then
  # Try Playwright json-output convention
  summary_file=$(find "$report_root" -type f -name "results.json" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | awk '{print $2}')
fi
if [[ -z "$summary_file" || ! -f "$summary_file" ]]; then
  check_fail "no machine-readable E2E summary file"
else
  passed=$(jq -r '.suites // [] | [.. | .tests? // empty | .[]? | select(.status == "passed")] | length' "$summary_file" 2>/dev/null)
  failed=$(jq -r '.suites // [] | [.. | .tests? // empty | .[]? | select(.status == "failed")] | length' "$summary_file" 2>/dev/null)
  # Fallback: top-level passed/failed counts if the nesting doesn't match.
  [[ -z "$passed" || "$passed" == "null" ]] && passed=$(jq -r '.stats.expected // .passed // 0' "$summary_file" 2>/dev/null)
  [[ -z "$failed" || "$failed" == "null" ]] && failed=$(jq -r '.stats.unexpected // .failed // 0' "$summary_file" 2>/dev/null)
  if [[ "${passed:-0}" -lt 1 ]]; then
    check_fail "E2E summary shows 0 passed tests"
  elif [[ "${failed:-0}" -gt 0 ]]; then
    check_fail "E2E summary shows $failed failed test(s)"
  else
    check_pass "E2E summary: $passed passed, $failed failed"
  fi
fi

# 4. Screenshots present for the linked issue
banner "gate 4/5: screenshots present (≥ ${min_screenshots})"
if [[ -n "$ISSUE" ]]; then
  shot_dir="tests/e2e/screenshots/$ISSUE"
  if [[ ! -d "$shot_dir" ]]; then
    check_fail "no screenshots/$ISSUE/ directory (is the issue linked?)"
  else
    count=$(find "$shot_dir" -type f \( -name "*.png" -o -name "*.jpg" \) | wc -l)
    if [[ "$count" -lt "$min_screenshots" ]]; then
      check_fail "screenshots/$ISSUE/ has $count files; minimum $min_screenshots required"
    else
      check_pass "$count screenshot(s) attached for issue #$ISSUE"
    fi
  fi
else
  # No issue provided — check ANY screenshots from the last hour
  count=$(find tests/e2e/screenshots -type f \( -name "*.png" -o -name "*.jpg" \) -mmin -60 2>/dev/null | wc -l)
  if [[ "$count" -lt "$min_screenshots" ]]; then
    check_fail "no recent screenshots (< ${min_screenshots} in last hour); pass --issue <N> for per-issue check"
  else
    check_pass "$count screenshot(s) produced in the last hour"
  fi
fi

# 5. Merge comment contains required evidence sections
banner "gate 5/5: merge comment has evidence sections"
if [[ -z "$COMMENT_FILE" || ! -f "$COMMENT_FILE" ]]; then
  check_fail "--comment-file not provided or missing"
else
  missing=()
  grep -qiE 'docker compose ps|compose ps|services.*healthy' "$COMMENT_FILE" || missing+=("docker compose ps block")
  grep -qiE 'playwright|newman|e2e|scenarios? (passed|green)' "$COMMENT_FILE" || missing+=("E2E / Playwright / Newman run output")
  grep -qiE 'screenshot|\.png|\.jpg' "$COMMENT_FILE" || missing+=("screenshot reference")
  if [[ "${#missing[@]}" -gt 0 ]]; then
    check_fail "merge comment missing sections: ${missing[*]}"
  else
    check_pass "merge comment contains all required evidence sections"
  fi
fi

# 6. Newman API test fresh + passing
banner "gate 6/7: Newman API test fresh + passing"
if [[ "$skip_api" == "1" ]]; then
  check_pass "skip-api set — PR has no API surface"
else
  newman_latest="tests/api/results/latest"
  if [[ ! -L "$newman_latest" && ! -f "$newman_latest" ]]; then
    check_fail "no tests/api/results/latest — Newman never ran"
  else
    # Pull the real path if it's a symlink
    newman_real=$([[ -L "$newman_latest" ]] && readlink -f "$newman_latest" || echo "$newman_latest")
    # Staleness
    now=$(date +%s)
    ts=$(stat -c %Y "$newman_real" 2>/dev/null || echo 0)
    age=$(( now - ts ))
    if (( age > report_max_age )); then
      check_fail "Newman report stale (${age}s > ${report_max_age}s cap): $newman_real"
    else
      # JUnit parse — look for failures attribute
      fails=$(grep -oE 'failures="[0-9]+"' "$newman_real" 2>/dev/null | head -1 | grep -oE '[0-9]+' || echo 0)
      if [[ "${fails:-0}" -gt 0 ]]; then
        check_fail "Newman reports $fails failing API test(s)"
      else
        check_pass "Newman report fresh + 0 failures: $newman_real"
      fi
    fi
  fi
fi

# 7. UAT run fresh + all personas passed
banner "gate 7/7: UAT personas fresh + passing"
if [[ "$skip_uat" == "1" ]]; then
  check_pass "skip-uat set — PR has no user-visible surface"
else
  uat_latest="tests/uat/results/latest"
  if [[ ! -L "$uat_latest" && ! -d "$uat_latest" ]]; then
    check_fail "no tests/uat/results/latest — UAT never ran"
  else
    uat_summary="$uat_latest/uat-run.summary.json"
    if [[ ! -f "$uat_summary" ]]; then
      check_fail "no uat-run.summary.json under $uat_latest"
    else
      uat_failed=$(jq -r '[.. | .status? // empty | select(. == "failed")] | length' "$uat_summary" 2>/dev/null || echo 0)
      uat_passed=$(jq -r '[.. | .status? // empty | select(. == "passed")] | length' "$uat_summary" 2>/dev/null || echo 0)
      if [[ "${uat_failed:-0}" -gt 0 ]]; then
        check_fail "UAT reports $uat_failed failed persona journey(s)"
      elif [[ "${uat_passed:-0}" -lt 1 ]]; then
        check_fail "UAT ran but 0 personas passed — no persona journey completed"
      else
        check_pass "UAT: $uat_passed persona(s) completed journey end-to-end"
      fi
    fi
  fi
fi

banner "gate summary"
echo "  Passed: $pass_count / 7"
echo "  Failed: ${#fail_reasons[@]}"
if [[ "${#fail_reasons[@]}" -gt 0 ]]; then
  echo ""
  echo "MERGE BLOCKED. Reasons:"
  for r in "${fail_reasons[@]}"; do
    echo "  - $r"
  done
  echo ""
  echo "Actions:"
  echo "  1. Fix the missing evidence (bring the stack up, re-run E2E,"
  echo "     re-capture screenshots), OR"
  echo "  2. Swap the PR back to claim:generator with a \\#\\# 수정 요청"
  echo "     comment naming the blockers."
  echo "  3. Do NOT merge by bypassing this gate."
  exit 1
fi

echo ""
echo "All gates passed. Evaluator may proceed with:"
echo "  gh pr merge $PR --merge --delete-branch --body-file $COMMENT_FILE"
exit 0
