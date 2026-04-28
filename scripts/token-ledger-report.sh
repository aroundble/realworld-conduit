#!/usr/bin/env bash
# token-ledger-report — summarize a role's token ledger.
#
# Output (JSON, single line):
#   {"role": "planner",
#    "samples": 482,
#    "session_tokens_k_current": 33.5,
#    "session_tokens_k_peak": 148.2,
#    "session_count": 6,               # distinct pane_pid values
#    "total_tokens_k_lifetime": 612.4, # sum of peak-per-session
#    "tokens_k_last_1h": 45.8,         # delta of session peak in window
#    "tokens_k_last_24h": 612.4}
#
# Model: the CLI footer is cumulative-within-session. A pane
# respawn starts a new session whose counter restarts from 0.
# "lifetime" = sum over each pane_pid's peak session_tokens_k.
# "last_1h" / "last_24h" = same logic bounded by window.
#
# Usage:
#   bash scripts/token-ledger-report.sh <role>
#
# Reads: $HARNESS_STATE_DIR/token-ledger-<role>.jsonl

set -uo pipefail

ROLE="${1:-}"
[[ -z "$ROLE" ]] && { echo '{"error":"role required"}'; exit 2; }

LEDGER="${HARNESS_STATE_DIR:-.githarness/state}/token-ledger-${ROLE}.jsonl"
if [[ ! -f "$LEDGER" ]]; then
  jq -nc --arg r "$ROLE" '{role: $r, samples: 0, session_tokens_k_current: 0, session_tokens_k_peak: 0, session_count: 0, total_tokens_k_lifetime: 0, tokens_k_last_1h: 0, tokens_k_last_24h: 0}'
  exit 0
fi

now_epoch=$(date -u +%s)
h1_cutoff_epoch=$((now_epoch - 3600))
h24_cutoff_epoch=$((now_epoch - 86400))
h1_cutoff_iso=$(date -u -d "@$h1_cutoff_epoch" +%Y-%m-%dT%H:%M:%SZ)
h24_cutoff_iso=$(date -u -d "@$h24_cutoff_epoch" +%Y-%m-%dT%H:%M:%SZ)

jq -s --arg role "$ROLE" --arg h1 "$h1_cutoff_iso" --arg h24 "$h24_cutoff_iso" '
  # group by pane_pid, compute peak per session
  (group_by(.pane_pid)
   | map({
       pid: .[0].pane_pid,
       peak: (map(.session_tokens_k) | max),
       peak_in_1h: (map(select(.ts > $h1)) | map(.session_tokens_k) | (max // 0)),
       peak_in_24h: (map(select(.ts > $h24)) | map(.session_tokens_k) | (max // 0)),
       last_seen: (map(.ts) | max)
     })) as $per_session
  | {
      role: $role,
      samples: length,
      session_tokens_k_current: (.[-1].session_tokens_k // 0),
      session_tokens_k_peak: ($per_session | map(.peak) | (max // 0)),
      session_count: ($per_session | length),
      total_tokens_k_lifetime: ($per_session | map(.peak) | add // 0),
      tokens_k_last_1h: ($per_session | map(.peak_in_1h) | add // 0),
      tokens_k_last_24h: ($per_session | map(.peak_in_24h) | add // 0)
    }
' "$LEDGER"
