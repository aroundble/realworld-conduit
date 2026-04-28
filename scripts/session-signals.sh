#!/usr/bin/env bash
# session-signals — single-query GitHub state snapshot for all roles.
#
# Problem this solves:
#   Prior to v0.2.27, session-next-issue.sh issued ~20 separate
#   `gh issue list` / `gh pr list` / `gh pr view` calls PER role per
#   watchdog cycle. With 3 roles × 60s cycles × 2 pilots running,
#   we were burning 7200+ GraphQL units/hour against a 5000/hour
#   quota. Every cycle hit the rate limit, watchdog entered backoff,
#   and the sprint loop deadlocked within an hour of any merge
#   activity. GitHub-native coordination is not viable under this
#   cost profile.
#
# Fix: one `gh api graphql` call returns everything three roles
# need — open issues (with labels + updatedAt), open PRs (with
# labels, draft flag, reviewDecision, head/base refs, last commit,
# recent comments), and merged PRs (with mergedAt). Cost: 3 units
# per cycle vs. ~20-40 previously. Post-processing is pure `jq`.
#
# Output (stdout JSON):
#   {
#     "repository": { ... raw GraphQL nodes ... },
#     "rateLimit":  { remaining, resetAt, cost },
#     "fetchedAt":  ISO-8601
#   }
#
# Env:
#   HARNESS_REPO          required, "org/name"
#   HARNESS_GH_LOW_WATER  default 500 — below this graphql remaining,
#                         emit a rate_limit_backoff JSON and exit 0
#                         (caller checks .reason == "rate_limit_backoff")
#
# Deps: gh (auth'd), jq

set -uo pipefail

REPO="${HARNESS_REPO:?HARNESS_REPO must be set}"
OWNER="${REPO%/*}"
NAME="${REPO##*/}"
RATE_LOW_WATER="${HARNESS_GH_LOW_WATER:-500}"

# Pre-flight rate check (cheap, does not consume quota per GitHub docs).
rate_remaining=$(gh api rate_limit --jq '.resources.graphql.remaining' 2>/dev/null || echo "")
if [[ -n "$rate_remaining" && "$rate_remaining" -lt "$RATE_LOW_WATER" ]]; then
  rate_reset=$(gh api rate_limit --jq '.resources.graphql.reset' 2>/dev/null || echo 0)
  now=$(date -u +%s)
  wait_secs=$(( rate_reset - now ))
  [[ "$wait_secs" -lt 0 ]] && wait_secs=0
  jq -nc --argjson rem "$rate_remaining" --argjson wait "$wait_secs" \
    '{reason: "rate_limit_backoff", graphql_remaining: $rem, wait_seconds: $wait}'
  exit 0
fi

# Single GraphQL query fetches everything. `lastCommit` and
# `lastComments` live inside the PR projection because matching
# them per-PR previously required N additional `gh pr view` calls.
read -r -d '' QUERY <<'GQL' || true
query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    openIssues: issues(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        updatedAt
        labels(first: 20) { nodes { name } }
      }
    }
    openPRs: pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        isDraft
        reviewDecision
        headRefName
        baseRefName
        updatedAt
        author { login }
        labels(first: 20) { nodes { name } }
        lastCommit: commits(last: 1) { nodes { commit { committedDate } } }
        lastComments: comments(last: 5) { nodes { createdAt body author { login } } }
      }
    }
    mergedPRs: pullRequests(states: MERGED, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number mergedAt }
    }
    closedIssues: issues(states: CLOSED, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        closedAt
        labels(first: 20) { nodes { name } }
      }
    }
  }
  rateLimit { remaining resetAt cost }
}
GQL

# Run it. `-F` sets typed variables; `-f query=...` ships the query
# string. Fail-open: on any error, emit a payload the caller can
# still parse (empty nodes lists + reason: "graphql_error").
resp=$(gh api graphql \
  -F owner="$OWNER" \
  -F name="$NAME" \
  -f query="$QUERY" 2>/dev/null || true)

if [[ -z "$resp" ]] || ! echo "$resp" | jq -e '.data.repository' >/dev/null 2>&1; then
  jq -nc '{reason: "graphql_error", repository: {openIssues: {nodes: []}, openPRs: {nodes: []}, mergedPRs: {nodes: []}, closedIssues: {nodes: []}}}'
  exit 0
fi

# Return the repository block + metadata. The rest of pipeline
# (session-next-issue.sh) applies jq filters per role to derive
# each counter.
echo "$resp" | jq -c --arg now "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" '{
  reason: "ok",
  fetchedAt: $now,
  repository: .data.repository,
  rateLimit: .data.rateLimit
}'
