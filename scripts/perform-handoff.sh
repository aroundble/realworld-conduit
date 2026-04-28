#!/usr/bin/env bash
# perform-handoff — spawn a successor pane next to the dying one.
#
# The dying session calls this at the start of its handoff turn.
# It splits the pane, launches a fresh `claude` in the new pane
# with the same role + working dir + env, and returns control to
# the caller (the dying session).
#
# From here on, the two sessions talk to each other **directly** by
# writing to the other pane with tmux send-keys. No GitHub issue
# roundtrip required. See the "Operational states" section in
# prompts/<role>.md for the exact protocol and the verification
# sequence.
#
# Usage (from the dying session's own bash tool call):
#   bash scripts/perform-handoff.sh
#
# Outputs (stdout, so the caller can parse):
#   SUCCESSOR_PANE_ID=%NN
#
# No detachment; the caller runs this synchronously during its turn.

set -euo pipefail

role="${HARNESS_SESSION_ROLE:-}"
if [[ -z "$role" ]]; then
  echo "error: HARNESS_SESSION_ROLE not set" >&2
  exit 2
fi

my_pane="${TMUX_PANE:-}"
if [[ -z "$my_pane" ]]; then
  echo "error: TMUX_PANE not set (not running inside tmux?)" >&2
  exit 2
fi

cwd="$(pwd)"

# Repo root (handoff flag lives here so all panes + hooks see it).
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$cwd")"
flag_file="$repo_root/.githarness/handoff-in-progress"

# Raise the handoff flag. Stop hook reads this and becomes a no-op
# while handoff is in progress; watchdog reads it and skips wakes.
mkdir -p "$(dirname "$flag_file")"
date -u +%Y-%m-%dT%H:%M:%SZ > "$flag_file"

# Autonomy: successors inherit the predecessor's autonomy contract.
# The default is --dangerously-skip-permissions because the whole
# harness is built on autonomous long-running sessions; if the
# successor stops on a permission prompt the handoff is dead.
# Opt out by setting HARNESS_AUTONOMY=interactive explicitly.
danger=""
autonomy="${HARNESS_AUTONOMY:-split}"
case "$autonomy" in
  interactive) danger="" ;;
  *)           danger=" --dangerously-skip-permissions" ;;
esac

# Build the env that the successor inherits. Same role. Same repo.
# Same language/tz. `HARNESS_HANDOFF_FROM` tells the successor it is
# the newer of a handoff pair.
env_exports=(
  "HARNESS_SESSION_ROLE=$role"
)
[[ -n "${HARNESS_REPO:-}" ]]           && env_exports+=("HARNESS_REPO=$HARNESS_REPO")
[[ -n "${HARNESS_LANGUAGE:-}" ]]       && env_exports+=("HARNESS_LANGUAGE=$HARNESS_LANGUAGE")
[[ -n "${HARNESS_TZ:-}" ]]             && env_exports+=("HARNESS_TZ=$HARNESS_TZ")
[[ -n "${HARNESS_OPERATOR_LEVEL:-}" ]] && env_exports+=("HARNESS_OPERATOR_LEVEL=$HARNESS_OPERATOR_LEVEL")
[[ -n "${HARNESS_AUTONOMY:-}" ]]       && env_exports+=("HARNESS_AUTONOMY=$HARNESS_AUTONOMY")
env_exports+=("HARNESS_HANDOFF_FROM=$my_pane")

env_str=$(printf 'env')
for kv in "${env_exports[@]}"; do
  env_str+=" $(printf '%q' "$kv")"
done

# Split the current pane horizontally (new pane to the right).
# Capture the new pane id from tmux.
new_pane=$(tmux split-window -h -t "$my_pane" -c "$cwd" -P -F '#{pane_id}' \
  "$env_str claude$danger")

# Mark both panes with titles so the operator knows what's going on.
tmux select-pane -t "$my_pane" -T "${role} (dying)"
tmux select-pane -t "$new_pane" -T "${role} (fresh)"
tmux set-option -t "$my_pane" pane-border-status top 2>/dev/null || true

# Return focus to the dying pane so the operator keeps seeing our
# final messages in the pane they were already reading.
tmux select-pane -t "$my_pane"

# Emit the new pane id so the caller can use it for send-keys.
echo "SUCCESSOR_PANE_ID=$new_pane"
