#!/usr/bin/env bash
# stop-pickup-next — Claude Code Stop hook.
#
# When a session tries to exit idle, check session-next-issue.sh and
# either allow exit (no signals) or block with a short reminder.
#
# Two overrides force allow-exit (hook is a no-op):
#   1. HARNESS_STOP_HOOK=0 in env
#   2. .githarness/handoff-in-progress file exists in the repo —
#      a handoff is underway and the session should not be nudged.
#
# If neither override applies:
#   - no signals                         → allow exit
#   - signals present, first time        → block with reminder
#   - signals present, same as last time → allow exit (respect
#     the session's judgment that this state does not require
#     action right now; the next state change will re-trigger)
#
# Design principle (see scripts/session-next-issue.sh):
#   The harness is label-schema-agnostic. We do not hardcode priority
#   labels, issue kinds, or per-role dispatch. We surface counts and
#   hand the session the authority to prioritize.
#
# Claude Code Stop hook contract:
#   stdin:  hook event JSON (ignored)
#   allow exit: print nothing, exit 0
#   block exit: print {"decision":"block","reason":"..."} then exit 0
#
# Env:
#   HARNESS_SESSION_ROLE           (required for the hook to do anything)
#   HARNESS_STOP_HOOK=0            disables the hook entirely
#   HARNESS_REPO                   forwarded to session-next-issue.sh
#   HARNESS_STOP_HOOK_STATE_DIR    where per-session signature state
#                                  is kept (default /tmp/harness-stop-hook)

set -uo pipefail

if [[ "${HARNESS_STOP_HOOK:-1}" == "0" ]]; then
  exit 0
fi

ROLE="${HARNESS_SESSION_ROLE:-}"
if [[ -z "$ROLE" ]]; then
  exit 0
fi

cat >/dev/null  # drain stdin

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Override 2: handoff-in-progress flag.
if [[ -f "$REPO_ROOT/.githarness/handoff-in-progress" ]]; then
  exit 0
fi

NEXT_SCRIPT="$REPO_ROOT/scripts/session-next-issue.sh"
if [[ ! -x "$NEXT_SCRIPT" ]]; then
  exit 0
fi

STATE_DIR="${HARNESS_STOP_HOOK_STATE_DIR:-/tmp/harness-stop-hook}"
mkdir -p "$STATE_DIR"

pane_id="${TMUX_PANE:-nopane}"
state_file="$STATE_DIR/${ROLE}-${pane_id}.state"

result=$("$NEXT_SCRIPT" 2>/dev/null || echo '{"has_work": false}')
has_work=$(echo "$result" | jq -r '.has_work // false')

if [[ "$has_work" != "true" ]]; then
  rm -f "$state_file"
  exit 0
fi

counts=$(echo "$result" | jq -c '.counts // {}')

# Build a signature from every key in counts, so any change in the
# GitHub state vector invalidates the dedup. We do not hardcode the
# key names — this stays label-schema-agnostic.
signature=$(echo "$counts" | jq -r 'to_entries | sort_by(.key) | map("\(.key)=\(.value)") | join("|")')

# If the session already saw this exact state and chose to end its
# turn, that is its judgment — allow exit. The next change of state
# (new rework, new claim, merged PR) will produce a different
# signature and re-trigger a block.
prev_sig=""
if [[ -f "$state_file" ]]; then
  prev_sig=$(sed -n '1p' "$state_file" 2>/dev/null || true)
fi

if [[ "$signature" == "$prev_sig" ]]; then
  # Second identical attempt → let the session out.
  rm -f "$state_file"
  exit 0
fi

# First time seeing this state — remember it and block once.
printf '%s\n' "$signature" > "$state_file"

summary=$(echo "$counts" | jq -r 'to_entries | map(select(.value > 0)) | map("\(.key)=\(.value)") | join(", ")')

# Role-identity drift detector.
#
# A role is a 5-surface tuple (pane name, worktree, env var,
# claim-label prefix, prompt file) that must stay in sync
# (see docs/role-identity.md). If the env advertises a role
# whose prompt file is missing, pickup will still run — it
# derives the claim label from HARNESS_SESSION_ROLE and will
# happily report "has_work=true" on issues for that label —
# but the session has no role prompt to follow, so "handle it
# per role discipline" is nonsense. We surface the drift
# explicitly instead of letting the session stall silently on
# "out of scope" conclusions it cannot justify.
prompt_file="prompts/${ROLE}.md"
identity_warning=""
if [[ ! -f "$REPO_ROOT/$prompt_file" ]]; then
  identity_warning=$'\n\n'"WARNING: \$HARNESS_SESSION_ROLE=${ROLE} but ${prompt_file} does not exist. The role identity tuple is inconsistent — see docs/role-identity.md. Pickup is querying claim:${ROLE} but the session has no role prompt to follow. Do not self-resolve; surface this to the operator and stop picking up work until the tuple is synchronised."
fi

reason=$(cat <<EOF
Signals: ${summary}

If this genuinely requires action per CLAUDE.md + ${prompt_file}, handle it and end the turn. If it is all out of your role scope (parent issues, observer-branch discipline edits, items waiting on another role), just end the turn again — this Stop will allow exit the second time.

Before doing any work, run: git pull --rebase so you have the latest CLAUDE.md and prompts/*.${identity_warning}
EOF
)

jq -nc --arg r "$reason" '{decision: "block", reason: $r}'
