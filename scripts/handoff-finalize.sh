#!/usr/bin/env bash
# handoff-finalize — kill the dying pane after successor confirmed.
#
# Called by the successor (after it has acknowledged the handoff is
# complete) to kill the predecessor pane and expand its own pane to
# the original role's slot.
#
# Usage (from the successor's bash tool call):
#   bash scripts/handoff-finalize.sh
#
# Reads HARNESS_HANDOFF_FROM from env to know which pane to kill.

set -euo pipefail

dying_pane="${HARNESS_HANDOFF_FROM:-}"
if [[ -z "$dying_pane" ]]; then
  echo "error: HARNESS_HANDOFF_FROM not set (am I really a handoff successor?)" >&2
  exit 2
fi

my_pane="${TMUX_PANE:-}"
role="${HARNESS_SESSION_ROLE:-planner}"

# Reset pane titles. We keep the role name; operator should now see
# one pane labeled with the role.
tmux select-pane -t "$my_pane" -T "$role" 2>/dev/null || true

# Kill the dying pane. This also gives us the freed screen space,
# which tmux auto-resizes.
tmux kill-pane -t "$dying_pane" 2>/dev/null || true

echo "predecessor pane $dying_pane killed; successor ($my_pane) now owns the $role slot."

# Drop the handoff flag so Stop hook / watchdog resume normal behavior.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
rm -f "$repo_root/.githarness/handoff-in-progress"
