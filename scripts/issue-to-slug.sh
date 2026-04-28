#!/usr/bin/env bash
# issue-to-slug — derive a branch slug from a GitHub issue title.
#
# Usage:
#   scripts/issue-to-slug.sh <issue-number> [--type feat|fix|...]
#
# Output (stdout):
#   <type>/<slug>-<issue-number>
#
# The <type> comes from --type (default: feat) OR, if the issue body
# includes a line "Suggested branch: feat/... ", that line is echoed
# verbatim (planner's preference wins).
#
# Env:
#   HARNESS_REPO  e.g. "org/repo"  (required; falls back to `gh repo view`)
set -euo pipefail

ISSUE="${1:-}"
if [[ -z "$ISSUE" ]]; then
  echo "usage: $0 <issue-number> [--type <type>]" >&2
  exit 2
fi
shift

TYPE="feat"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type) TYPE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO="${HARNESS_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)}"
if [[ -z "$REPO" ]]; then
  echo "HARNESS_REPO not set and gh repo view failed" >&2
  exit 2
fi

# Fetch title and body.
payload=$(gh issue view "$ISSUE" --repo "$REPO" --json title,body 2>/dev/null || echo '{}')
title=$(echo "$payload" | jq -r '.title // empty')
body=$(echo "$payload" | jq -r '.body // empty')

if [[ -z "$title" ]]; then
  echo "could not read issue #$ISSUE in $REPO" >&2
  exit 1
fi

# Planner may have suggested an exact branch name in the body.
suggested=$(printf '%s\n' "$body" | grep -oE 'Suggested branch:\s*[^[:space:]]+' | head -1 | awk '{print $NF}')
if [[ -n "$suggested" ]]; then
  echo "$suggested"
  exit 0
fi

# Otherwise derive slug from the title.
#  - drop any leading "[Px]", "[tag]", "Px:" prefix
#  - lowercase
#  - keep ASCII letters/digits, collapse whitespace/punct into hyphens
#  - cap length at 40 chars (conventional)
slug=$(printf '%s' "$title" \
  | sed -E 's/^\[[^]]*\]\s*//; s/^[Pp][0-9]+:\s*//; s/^[Pp][0-9]+\s*-\s*//' \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' \
  | cut -c1-40 \
  | sed -E 's/-+$//')

if [[ -z "$slug" ]]; then
  slug="issue"
fi

echo "${TYPE}/${slug}-${ISSUE}"
