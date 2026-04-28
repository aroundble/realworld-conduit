#!/usr/bin/env bash
# session-next-issue — role-aware signal summary, one GraphQL call total.
#
# Output on stdout (JSON):
#   {"has_work": true|false, "reason": "<short code>", "counts": {...}}
#
# Design principle (harness layer is label-schema-agnostic):
#   The harness does NOT know what P0/P1/... mean, or which labels
#   are priority vs area vs type. Those are project conventions.
#   The harness ONLY knows the `claim:*` label prefix, GitHub-native
#   review state (reviewDecision), the rework-comment header
#   convention, and the sprint/N / sprint-demo:N-pass label schema
#   documented in CLAUDE.md.
#
# Signals this script reports (counts only — no issue/PR numbers):
#   (1) claimed_issues / claimed_prs          — label:claim:<role>
#   (2) rework_native / rework_comment        — own PR with rework pending
#   (3) unclaimed_issues                      — no claim:*, not blocked,
#                                                not parent/tracking
#   (4) review_queue                          — open PRs without my claim
#   (5) contract_proposals                    — claim:generator-proposal
#   (6) post_merge_prs (planner)              — merged PRs past ack marker
#   (7) new_e2e_reports (planner)             — E2E artifacts newer than marker
#   (8) operator_comments (planner)           — updated items past marker
#   (9) planner_claimed_issues (all)          — label:claim:planner open
#
# v0.2.28 removed counter 10 (sprints_ready_to_advance) along with
# the sprint construct itself — Anthropic V2 blog dropped sprints
# with Opus 4.6, and our planner now continuously drains a single
# roadmap.md instead of advancing by discrete demo gates.
#
# Env:
#   HARNESS_REPO, HARNESS_SESSION_ROLE        required
#   HARNESS_REWORK_COMMENT_REGEX              default covers 수정 요청 / rework /
#                                             change-request variants
#   HARNESS_GH_LOW_WATER                      graphql low-water mark (default 500)
#
# Deps: gh, jq. Backing data comes from scripts/session-signals.sh
# (single GraphQL call; sentinel values `reason: rate_limit_backoff`
# or `graphql_error` are surfaced to the caller as-is).

set -uo pipefail

REPO="${HARNESS_REPO:?HARNESS_REPO must be set, e.g. 'org/project'}"
ROLE="${HARNESS_SESSION_ROLE:-}"
REWORK_REGEX="${HARNESS_REWORK_COMMENT_REGEX:-^##\\s*(⚠️\\s*)?(수정\\s*요청|rework|change[- ]request|changes[- ]requested)}"

HERE="$(cd "$(dirname "$0")" && pwd)"
SIGNALS_SH="$HERE/session-signals.sh"

emit_none() {
  jq -nc --arg r "$1" '{has_work: false, reason: $r, counts: {}}'
  exit 0
}

emit_work() {
  jq -nc --arg r "$1" --argjson c "$2" \
    '{has_work: true, reason: $r, counts: $c}'
  exit 0
}

emit_backoff() {
  local rem="$1" wait="$2"
  jq -nc --argjson rem "$rem" --argjson wait "$wait" \
    '{has_work: false, reason: "rate_limit_backoff", counts: {}, graphql_remaining: $rem, wait_seconds: $wait}'
  exit 0
}

# Empty role = ad-hoc session, harness pickup disabled.
if [[ -z "$ROLE" ]]; then
  emit_none "no_role"
fi

CLAIM_LABEL="claim:$ROLE"

# One call, all three roles' worth of GitHub state.
snapshot=$("$SIGNALS_SH" 2>/dev/null || echo '{"reason":"script_error"}')
snap_reason=$(echo "$snapshot" | jq -r '.reason // "script_error"')

if [[ "$snap_reason" == "rate_limit_backoff" ]]; then
  rem=$(echo "$snapshot" | jq -r '.graphql_remaining // 0')
  wait=$(echo "$snapshot" | jq -r '.wait_seconds // 0')
  emit_backoff "$rem" "$wait"
fi

# graphql_error / script_error — fail open so the session is not
# frozen by a transient network blip. has_work=false but with a
# distinct reason so logs show what happened.
if [[ "$snap_reason" != "ok" ]]; then
  emit_none "$snap_reason"
fi

# All counters derive from a single jq pipeline over the snapshot.
# Each counter is computed as a bash variable so the final JSON
# assembly (bottom of script) stays legible.

# ---- counter (1): claimed_issues / claimed_prs ----
claimed_issues=$(echo "$snapshot" | jq --arg cl "$CLAIM_LABEL" '
  [.repository.openIssues.nodes[]
   | select(.labels.nodes | map(.name) | index($cl))] | length
')
claimed_prs=$(echo "$snapshot" | jq --arg cl "$CLAIM_LABEL" '
  [.repository.openPRs.nodes[]
   | select(.labels.nodes | map(.name) | index($cl))] | length
')

# ---- counter (2a): rework_native — reviewDecision-based ----
# GitHub login of the agent ≠ role; all three roles share one
# account, so "my" PR is any PR we've authored. We approximate
# "author=me" by checking PRs for CHANGES_REQUESTED; a self-
# authored PR with CHANGES_REQUESTED is rework whoever picks it.
rework_native=$(echo "$snapshot" | jq '
  [.repository.openPRs.nodes[]
   | select(.reviewDecision == "CHANGES_REQUESTED")] | length
')

# ---- counter (2b): rework_comment — self-PR fallback ----
# A PR needs rework iff any comment newer than the last commit
# matches the rework header regex. All comment data is already
# in the snapshot; zero extra network calls.
rework_comment=$(echo "$snapshot" | jq --arg rx "$REWORK_REGEX" '
  [.repository.openPRs.nodes[]
   | select((.reviewDecision // "") == "")
   | (.lastCommit.nodes[0].commit.committedDate // "") as $commit_ts
   | select(
       (.lastComments.nodes // [])
       | map(select((.createdAt // "") > $commit_ts))
       | map(select((.body // "") | test($rx; "i")))
       | length > 0
     )
  ] | length
')
rework=$(( rework_native + rework_comment ))

# ---- counter (3): unclaimed_issues ----
# Exclude any claim:*, blocked, parent/tracking/epic, title
# ending with "(parent)".
unclaimed_issues=$(echo "$snapshot" | jq '
  [.repository.openIssues.nodes[]
   | select(.labels.nodes | map(.name) | any(. == "blocked") | not)
   | select(.labels.nodes | map(.name) | any(startswith("claim:")) | not)
   | select((.title // "") | test("\\(parent\\)\\s*$") | not)
   | select(.labels.nodes | map(.name) | any(. == "parent" or . == "tracking" or . == "epic") | not)
  ] | length
')

# ---- counter (4): review_queue ----
# Open, not-draft, not self-sync, not carrying my claim.
review_queue=$(echo "$snapshot" | jq --arg cl "$CLAIM_LABEL" '
  [.repository.openPRs.nodes[]
   | select(.isDraft == false)
   | select(.headRefName != .baseRefName)
   | select(.headRefName != "main" and .headRefName != "latest")
   | select(.labels.nodes | map(.name) | index($cl) | not)
  ] | length
')

# ---- counter (5): contract_proposals ----
contract_proposals=$(echo "$snapshot" | jq '
  [.repository.openIssues.nodes[]
   | select(.labels.nodes | map(.name) | index("claim:generator-proposal"))] | length
')

# ---- counter (9, all roles): planner_claimed_issues ----
# Visible to ALL roles, not just planner. Generator sees this and
# stays out; evaluator sees it and knows the planner has work
# waiting (useful for Audit-E label-swap decisions on shared PRs).
planner_claimed_issues=$(echo "$snapshot" | jq '
  [.repository.openIssues.nodes[]
   | select(.labels.nodes | map(.name) | index("claim:planner"))] | length
')

# ---- counter (blocked_items, planner-only): legacy blocked-label catch ----
# Counts open issues + PRs carrying the `blocked` label (but NOT
# `blocked-external:*` — those are legitimate outage markers).
# v0.2.41 `blocked` is deprecated; planner Audit I reroutes.
# Planner wakes on this counter to clear legacy violations.
blocked_items=$(echo "$snapshot" | jq '
  ([.repository.openIssues.nodes[]
    | select(.labels.nodes | map(.name) | any(. == "blocked"))] | length)
  +
  ([.repository.openPRs.nodes[]
    | select(.labels.nodes | map(.name) | any(. == "blocked"))] | length)
')

# ---- planner-only counters (6-8): post_merge_prs, new_e2e_reports, operator_comments ----
post_merge_prs=0
new_e2e_reports=0
operator_comments=0
marker_iso="1970-01-01T00:00:00Z"

if [[ "$ROLE" == "planner" ]]; then
  # v0.2.34: marker lives under HARNESS_STATE_DIR alongside the
  # hook state files so planner (writing from role/planner worktree)
  # and watchdog (reading from main clone) agree on location
  # without committing the marker to git. The cwd-relative path
  # below is kept as a fallback for pre-v0.2.34 projects whose
  # state dir env is not yet wired.
  state_dir="${HARNESS_STATE_DIR:-.githarness/state}"
  marker_file="$state_dir/planner-acked-at.iso8601"
  # Legacy fallback: pre-v0.2.34 projects had the marker at
  # .githarness/planner-acked-at.iso8601 (tracked in git). Respect
  # it if still there and the new path is absent, so mid-upgrade
  # projects don't lose the marker timestamp.
  [[ ! -f "$marker_file" && -f ".githarness/planner-acked-at.iso8601" ]] && \
    marker_file=".githarness/planner-acked-at.iso8601"
  if [[ -f "$marker_file" ]]; then
    m=$(cat "$marker_file" 2>/dev/null | tr -d '[:space:]')
    [[ -n "$m" ]] && marker_iso="$m"
  fi

  # (6) merged PRs newer than marker.
  post_merge_prs=$(echo "$snapshot" | jq --arg m "$marker_iso" '
    [.repository.mergedPRs.nodes[]
     | select((.mergedAt // "") > $m)] | length
  ')

  # (7) E2E reports newer than marker — filesystem check, not GitHub.
  if [[ -d tests/e2e/test-results ]]; then
    ref_file=$(mktemp)
    if touch -d "$marker_iso" "$ref_file" 2>/dev/null; then
      new_e2e_reports=$(find tests/e2e/test-results -type f \
        \( -name '*.html' -o -name 'summary.json' \) \
        -newer "$ref_file" 2>/dev/null | wc -l)
    fi
    rm -f "$ref_file"
  fi

  # (8) operator_comments heuristic — open items updated past marker.
  # Over-counts (agents also update), the planner filters per-thread.
  operator_comments=$(echo "$snapshot" | jq --arg m "$marker_iso" '
    ([.repository.openIssues.nodes[]
      | select((.updatedAt // "") > $m)] | length)
    +
    ([.repository.openPRs.nodes[]
      | select((.updatedAt // "") > $m)] | length)
  ')
fi

counts=$(jq -nc \
  --argjson ci "$claimed_issues" \
  --argjson cp "$claimed_prs" \
  --argjson rw "$rework" \
  --argjson rn "$rework_native" \
  --argjson rc "$rework_comment" \
  --argjson ui "$unclaimed_issues" \
  --argjson rq "$review_queue" \
  --argjson pm "$post_merge_prs" \
  --argjson ne "$new_e2e_reports" \
  --argjson cn "$contract_proposals" \
  --argjson oc "$operator_comments" \
  --argjson pc "$planner_claimed_issues" \
  --argjson bl "$blocked_items" \
  '{
    claimed_issues: $ci,
    claimed_prs: $cp,
    rework: $rw,
    rework_native: $rn,
    rework_comment: $rc,
    unclaimed_issues: $ui,
    review_queue: $rq,
    post_merge_prs: $pm,
    new_e2e_reports: $ne,
    contract_proposals: $cn,
    operator_comments: $oc,
    planner_claimed_issues: $pc,
    blocked_items: $bl
  }')

# blocked_items wakes planner only (Audit I).
planner_signal=0
if [[ "$ROLE" == "planner" && "$blocked_items" -gt 0 ]]; then
  planner_signal=$blocked_items
fi

total=$(( claimed_issues + claimed_prs + rework + unclaimed_issues
        + review_queue + post_merge_prs + new_e2e_reports
        + contract_proposals + operator_comments
        + planner_claimed_issues + planner_signal ))

if [[ "$total" -gt 0 ]]; then
  emit_work "signals_present" "$counts"
fi

emit_none "idle"
