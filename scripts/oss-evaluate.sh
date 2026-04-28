#!/usr/bin/env bash
# oss-evaluate — compute reuse-viability metrics for a single
# GitHub repo. The planner (or `.agents/oss-scout.md` subagent)
# calls this for each candidate the oss-discover.sh short-list
# returns, and uses the merged JSON to rank absorb / adapt /
# reject / defer decisions.
#
# Metrics:
#   - license (SPDX id)
#   - last_push (ISO timestamp)
#   - days_since_last_push
#   - stars
#   - forks
#   - open_issues
#   - default_branch
#   - primary_lang
#   - archived (bool)
#   - disabled (bool)
#   - topics (array)
#   - signals:
#       maintained: bool         (< 180 days since last push and not archived)
#       popular: bool            (stars >= 100)
#       license_permissive: bool (MIT / BSD / Apache-2.0 / ISC / Unlicense)
#       license_copyleft: bool   (GPL / AGPL / LGPL / MPL)
#       license_source_available: bool (BSL / SSPL / ELv2)
#       license_unknown: bool    (no detected license)
#
# Input:
#   - positional arg 1: "<owner>/<repo>" or full github URL.
# Output:
#   - JSON on stdout. If the repo is unreachable, emits
#     {"error": "...", "slug": "..."} with exit 0.
#
# Deps: gh (authenticated), jq.

set -uo pipefail

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo '{"error":"usage: oss-evaluate.sh <owner/repo>"}' >&2
  exit 2
fi

# Strip a full URL down to owner/repo if needed.
SLUG=$(echo "$SLUG" | sed -E 's|^https?://github\.com/||; s|\.git$||; s|/$||')

if ! command -v gh >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  jq -n --arg s "$SLUG" '{error:"missing deps: gh + jq required", slug:$s}'
  exit 0
fi

raw=$(gh api "repos/$SLUG" 2>/dev/null) || raw=""
if [[ -z "$raw" ]]; then
  jq -n --arg s "$SLUG" '{error:"gh api failed (not found or auth)", slug:$s}'
  exit 0
fi

topics_raw=$(gh api "repos/$SLUG/topics" 2>/dev/null) || topics_raw='{"names":[]}'

jq -n \
  --argjson r "$raw" \
  --argjson t "$topics_raw" \
  '
  def days_since($iso):
    if ($iso == null or $iso == "") then null
    else (now - ($iso | fromdateiso8601)) / 86400 | floor
    end;

  ($r.license.spdx_id // null) as $lic |
  {
    slug:                $r.full_name,
    license:             $lic,
    last_push:           ($r.pushed_at // null),
    days_since_last_push:days_since($r.pushed_at),
    stars:               ($r.stargazers_count // 0),
    forks:               ($r.forks_count // 0),
    open_issues:         ($r.open_issues_count // 0),
    default_branch:      ($r.default_branch // null),
    primary_lang:        ($r.language // null),
    archived:            ($r.archived // false),
    disabled:            ($r.disabled // false),
    topics:              ($t.names // []),
    signals: {
      maintained: (
        ($r.archived // false | not)
        and (
          (($r.pushed_at // "") | length) > 0
          and ((now - ($r.pushed_at | fromdateiso8601)) / 86400) < 180
        )
      ),
      popular:                  (($r.stargazers_count // 0) >= 100),
      license_permissive:       ($lic != null and ($lic | IN("MIT","BSD-2-Clause","BSD-3-Clause","Apache-2.0","ISC","Unlicense"))),
      license_copyleft:         ($lic != null and ($lic | test("^(GPL|AGPL|LGPL|MPL)-"))),
      license_source_available: ($lic != null and ($lic | IN("BSL-1.0","Elastic-2.0","SSPL-1.0"))),
      license_unknown:          ($lic == null)
    }
  }'
