#!/usr/bin/env bash
# oss-discover — search the open-source world for prior art that
# matches a feature description. Produces a JSON short-list of
# candidate upstream projects that the planner (or the
# `.agents/oss-scout.md` subagent) can feed into oss-evaluate.sh.
#
# This script implements step 1 of the planner's Branch 2
# (Reference research) per prompts/planner.md. See
# skills/for-all-roles/scope-discipline.md and
# docs/10-external-ingest-workflow.md for the broader pipeline.
#
# Inputs:
#   - positional args: free-form search query (e.g. "llm gateway
#     with guardrails"). Joined with spaces into a single query.
#   - env HARNESS_SCOUT_LANG (optional): primary language filter
#     (e.g. "python", "typescript", "go"). Restricts the GitHub
#     repo search.
#   - env HARNESS_SCOUT_LIMIT (optional): max results per source,
#     default 5.
#
# Output: JSON to stdout with shape:
#   {
#     "query": "...",
#     "sources": {
#       "github_repos":   [{"name": "...", "url": "...", "desc": "...", "stars": N, "lang": "..."}],
#       "github_topics":  [{"name": "...", "url": "...", "desc": "...", "stars": N, "lang": "..."}],
#       "npm":            [{"name": "...", "url": "...", "desc": "...", "version": "..."}],
#       "pypi":           [{"name": "...", "url": "...", "desc": "...", "version": "..."}],
#       "cargo":          [{"name": "...", "url": "...", "desc": "...", "version": "..."}]
#     }
#   }
#
# Sources that are unavailable (gh not authenticated, network
# missing, registry HTTP 4xx/5xx) are reported as empty arrays
# rather than errors. The planner's OSS-scout subagent picks the
# best 3–5 candidates from the aggregated list.
#
# Deps:
#   - gh (authenticated)    — required for github_repos / github_topics
#   - jq                    — required for JSON assembly
#   - curl                  — optional, for npm/pypi/cargo HTTP
#     if not present, those registries return empty arrays.

set -uo pipefail

QUERY="$*"
if [[ -z "$QUERY" ]]; then
  echo '{"error":"usage: oss-discover.sh <query>"}' >&2
  exit 2
fi

LIMIT="${HARNESS_SCOUT_LIMIT:-5}"
LANG_FILTER="${HARNESS_SCOUT_LANG:-}"

# ---- github repo search ----
gh_repos='[]'
if command -v gh >/dev/null 2>&1; then
  lang_q=""
  if [[ -n "$LANG_FILTER" ]]; then
    lang_q="--language=$LANG_FILTER"
  fi
  gh_repos=$(gh search repos "$QUERY" $lang_q \
    --limit "$LIMIT" \
    --json name,fullName,description,url,stargazersCount,primaryLanguage \
    2>/dev/null \
    | jq 'map({
        name: .fullName,
        url: .url,
        desc: (.description // ""),
        stars: (.stargazersCount // 0),
        lang: (.primaryLanguage.name // "")
      })' 2>/dev/null) || gh_repos='[]'
  [[ -z "$gh_repos" ]] && gh_repos='[]'
fi

# ---- github topics (stringent signal: community-curated) ----
gh_topics='[]'
if command -v gh >/dev/null 2>&1; then
  first_word=$(echo "$QUERY" | awk '{print $1}' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')
  if [[ -n "$first_word" ]]; then
    gh_topics=$(gh search repos "topic:$first_word" \
      --limit "$LIMIT" \
      --json name,fullName,description,url,stargazersCount,primaryLanguage \
      2>/dev/null \
      | jq 'map({
          name: .fullName,
          url: .url,
          desc: (.description // ""),
          stars: (.stargazersCount // 0),
          lang: (.primaryLanguage.name // "")
        })' 2>/dev/null) || gh_topics='[]'
    [[ -z "$gh_topics" ]] && gh_topics='[]'
  fi
fi

# ---- npm registry search ----
npm_json='[]'
if command -v curl >/dev/null 2>&1; then
  enc_q=$(printf '%s' "$QUERY" | jq -sRr @uri)
  npm_json=$(curl -fsSL "https://registry.npmjs.org/-/v1/search?text=$enc_q&size=$LIMIT" 2>/dev/null \
    | jq '[.objects[]? | {
        name: .package.name,
        url: (.package.links.npm // .package.links.repository // ""),
        desc: (.package.description // ""),
        version: (.package.version // "")
      }]' 2>/dev/null) || npm_json='[]'
  [[ -z "$npm_json" ]] && npm_json='[]'
fi

# ---- pypi search (the official PyPI XML-RPC search is dead; we
# use the "project" lookup when the query looks like a package
# name, otherwise fall back to an empty array and let the planner
# use github as the primary pypi discovery surface) ----
pypi_json='[]'
if command -v curl >/dev/null 2>&1; then
  slug=$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-_.' )
  if [[ -n "$slug" ]]; then
    pypi_raw=$(curl -fsSL "https://pypi.org/pypi/$slug/json" 2>/dev/null) || pypi_raw=""
    if [[ -n "$pypi_raw" ]]; then
      pypi_json=$(echo "$pypi_raw" | jq '[{
          name: .info.name,
          url: (.info.project_url // ("https://pypi.org/project/" + .info.name)),
          desc: (.info.summary // ""),
          version: (.info.version // "")
        }]' 2>/dev/null) || pypi_json='[]'
    fi
  fi
fi

# ---- cargo (crates.io) search ----
cargo_json='[]'
if command -v curl >/dev/null 2>&1; then
  enc_q=$(printf '%s' "$QUERY" | jq -sRr @uri)
  cargo_raw=$(curl -fsSL -H 'User-Agent: githarness-oss-scout/1.0' \
    "https://crates.io/api/v1/crates?q=$enc_q&per_page=$LIMIT" 2>/dev/null) || cargo_raw=""
  if [[ -n "$cargo_raw" ]]; then
    cargo_json=$(echo "$cargo_raw" | jq '[.crates[]? | {
        name: .name,
        url: ("https://crates.io/crates/" + .name),
        desc: (.description // ""),
        version: (.max_version // .newest_version // "")
      }]' 2>/dev/null) || cargo_json='[]'
  fi
fi

jq -n \
  --arg q "$QUERY" \
  --argjson gr "$gh_repos" \
  --argjson gt "$gh_topics" \
  --argjson n  "$npm_json" \
  --argjson p  "$pypi_json" \
  --argjson c  "$cargo_json" \
  '{
    query: $q,
    sources: {
      github_repos:  $gr,
      github_topics: $gt,
      npm:           $n,
      pypi:          $p,
      cargo:         $c
    }
  }'
