#!/usr/bin/env bash
# session-launch.sh — launch a role's Claude Code session with the
# correct --settings posture.
#
# Called by tmux-layout.js at init and by session-watchdog.sh on
# restart. The point of having a dedicated launcher (vs. inlining
# everything into a one-shot `tmux send-keys` line) is that the
# inlined form grew to ~1.5KB of JSON + exports, which the
# receiving terminal's readline buffer would silently truncate —
# symptom: `harness.N` pane sits at a bare shell, no claude
# running, no error message, and the operator sees only
# "everything looks fine but nothing happens". Moving the posture
# here means the one-liner tmux actually sends is short and
# predictable.
#
# All configuration flows in via env vars — same variables every
# role prompt already documents. No CLI flags.
#
# Required env:
#   HARNESS_SESSION_ROLE           planner | generator | evaluator
#   HARNESS_REPO                   owner/name
#   HARNESS_SESSION_SHORT_ID       <role-abbr>-<base36-ts>
#
# Optional env (all have safe defaults):
#   HARNESS_AUTONOMY               full-auto | split | cautious  (default: full-auto)
#   HARNESS_OPERATOR_LEVEL         expert | default | hands-off  (default: default)
#   HARNESS_CLOUD                  aws                           (default: aws)
#   HARNESS_DEPLOY_MODE            cloud | local-only            (default: local-only)
#   HARNESS_LANGUAGE               en | ko | ja | ...            (default: en)
#   HARNESS_TZ                     IANA TZ                       (default: UTC)

set -u

role="${HARNESS_SESSION_ROLE:-}"
if [[ -z "$role" ]]; then
  echo "session-launch.sh: HARNESS_SESSION_ROLE not set" >&2
  exit 2
fi

# Autonomy gate — whether this specific role gets `--dangerously-skip-permissions`.
# split mode: only generator runs dangerously; others still prompt. full-auto: all three.
# cautious: none.
autonomy="${HARNESS_AUTONOMY:-full-auto}"
danger_flag=""
case "$autonomy" in
  full-auto)
    danger_flag="--dangerously-skip-permissions"
    ;;
  split)
    if [[ "$role" == "generator" ]]; then
      danger_flag="--dangerously-skip-permissions"
    fi
    ;;
  cautious)
    ;;
  *)
    echo "session-launch.sh: unknown HARNESS_AUTONOMY='$autonomy'" >&2
    exit 2
    ;;
esac

# --settings posture — package-resident, read from this script's
# sibling config file. Kept as JSON in a file (not here-string)
# so operators can tweak it project-locally without patching this
# shell script.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
settings_file="$here/session-launch.settings.json"
if [[ ! -f "$settings_file" ]]; then
  echo "session-launch.sh: settings file missing: $settings_file" >&2
  exit 2
fi

# Pre-flight: claude CLI must be on PATH.
if ! command -v claude >/dev/null 2>&1; then
  echo "session-launch.sh: 'claude' not on PATH — install Claude Code CLI first" >&2
  exit 2
fi

# Announce so the operator sees which role/short-id this pane has.
echo "[session-launch] role=$role short_id=${HARNESS_SESSION_SHORT_ID:-<unset>} autonomy=$autonomy deploy=${HARNESS_DEPLOY_MODE:-local-only}"

# `claude --settings <path>` accepts the settings JSON directly
# from the file. exec so `ps` / `tmux list-panes -F
# '#{pane_current_command}'` reports `node` (claude's binary),
# which is what the liveness probe in
# tmux-layout.js:verifyRolePanesAlive() checks for.
if [[ -n "$danger_flag" ]]; then
  exec claude "$danger_flag" --settings "$settings_file"
else
  exec claude --settings "$settings_file"
fi
