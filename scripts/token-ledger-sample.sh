#!/usr/bin/env bash
# token-ledger-sample — one-shot token sample for a role.
#
# Source: Claude Code writes one JSONL file per session at
#   ~/.claude/projects/<slugified-cwd>/<session-uuid>.jsonl
# Each `type: "assistant"` record carries exact token usage:
#   .message.usage.input_tokens          (model-input, non-cached)
#   .message.usage.cache_creation_input_tokens
#   .message.usage.cache_read_input_tokens
#   .message.usage.output_tokens
#
# This script finds the role's worktree session file, extracts
# the last (or cumulative) usage numbers, and appends a JSONL
# row to $HARNESS_STATE_DIR/token-ledger-<role>.jsonl with
# precise per-turn data.
#
# This replaces the v0.2.38-first-version pane-footer scrape,
# which lost data after end-of-turn because the footer vanished.
#
# Usage:
#   bash scripts/token-ledger-sample.sh <role> <worktree-path> [session-id]
#
# <session-id> is optional; if omitted, uses the most-recently
# modified session file in the project slug's dir (which
# matches the currently running pane).

set -uo pipefail

ROLE="${1:-}"
WORKTREE="${2:-}"
SESSION_HINT="${3:-}"

[[ -z "$ROLE" || -z "$WORKTREE" ]] && exit 0
[[ ! -d "$WORKTREE" ]] && exit 0

LEDGER_DIR="${HARNESS_STATE_DIR:-$(dirname "$WORKTREE")/.githarness/state}"
LEDGER="$LEDGER_DIR/token-ledger-${ROLE}.jsonl"
mkdir -p "$LEDGER_DIR" 2>/dev/null || exit 0

# Slug format Claude Code uses: replace '/' with '-' in the absolute path.
# e.g. /home/ec2-user/Workspaces/hot-deal-init/hot-deal-planner
#  →   -home-ec2-user-Workspaces-hot-deal-init-hot-deal-planner
slug=$(echo "$WORKTREE" | sed 's|/|-|g')
proj_dir="$HOME/.claude/projects/$slug"
[[ ! -d "$proj_dir" ]] && exit 0

# Pick session file.
if [[ -n "$SESSION_HINT" && -f "$proj_dir/${SESSION_HINT}.jsonl" ]]; then
  session_file="$proj_dir/${SESSION_HINT}.jsonl"
else
  session_file=$(ls -1t "$proj_dir"/*.jsonl 2>/dev/null | head -1)
fi
[[ -z "$session_file" || ! -f "$session_file" ]] && exit 0

# Compute cumulative usage across the session file. Sum each
# turn's (input_tokens + cache_creation_input_tokens +
# cache_read_input_tokens + output_tokens).
summary=$(jq -s '
  map(select(.type == "assistant" and .message.usage != null)
      | .message.usage as $u
      | {
          input: ($u.input_tokens // 0),
          cache_creation: ($u.cache_creation_input_tokens // 0),
          cache_read: ($u.cache_read_input_tokens // 0),
          output: ($u.output_tokens // 0),
          ts: .timestamp
        })
  | {
      turns: length,
      input_total: (map(.input) | add // 0),
      cache_creation_total: (map(.cache_creation) | add // 0),
      cache_read_total: (map(.cache_read) | add // 0),
      output_total: (map(.output) | add // 0),
      last_turn_ts: (map(.ts) | max)
    }
' "$session_file" 2>/dev/null)
[[ -z "$summary" ]] && exit 0

turns=$(echo "$summary" | jq -r '.turns // 0')
[[ "$turns" == "0" ]] && exit 0

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
session_id=$(basename "$session_file" .jsonl)

# Emit the row. Priced fields use Opus-4.7 input-type pricing
# (values in USD per 1M tokens) — let the consumer do totals.
jq -nc \
  --arg ts "$ts" \
  --arg role "$ROLE" \
  --arg session_id "$session_id" \
  --argjson turns "$turns" \
  --argjson input "$(echo "$summary" | jq -r '.input_total')" \
  --argjson cache_creation "$(echo "$summary" | jq -r '.cache_creation_total')" \
  --argjson cache_read "$(echo "$summary" | jq -r '.cache_read_total')" \
  --argjson output "$(echo "$summary" | jq -r '.output_total')" \
  --arg last_turn "$(echo "$summary" | jq -r '.last_turn_ts')" \
  '{
    ts: $ts,
    role: $role,
    session_id: $session_id,
    turns: $turns,
    input_tokens: $input,
    cache_creation_input_tokens: $cache_creation,
    cache_read_input_tokens: $cache_read,
    output_tokens: $output,
    total_tokens: ($input + $cache_creation + $cache_read + $output),
    last_turn_ts: $last_turn
  }' >> "$LEDGER" 2>/dev/null || true

exit 0
