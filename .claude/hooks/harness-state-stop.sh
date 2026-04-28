#!/usr/bin/env bash
# harness-state-stop — Stop hook.
#
# Records "this role just finished a turn" by touching a per-role
# mtime file. Paired with harness-state-activity (PreToolUse); the
# watchdog compares mtimes to decide busy vs. idle:
#
#   last-activity > last-stop   AND fresh → agent is running a tool
#   last-activity > last-stop   AND stale → agent is hung (fallback)
#   last-activity <= last-stop            → agent is idle
#
# Fail-open, never blocks the exit. Runs alongside stop-pickup-next.sh
# (registered separately); the two do not coordinate.
#
# Env:
#   HARNESS_SESSION_ROLE         required — per-role mtime file name
#   HARNESS_STATE_DIR            default: ${CLAUDE_PROJECT_DIR}/.githarness/state
#   CLAUDE_PROJECT_DIR           provided by Claude Code
#   HARNESS_STATE_DISABLED=1     disable the hook entirely
#
# State file:
#   ${HARNESS_STATE_DIR}/${role}.last-stop          (mtime-only; empty content)

set -uo pipefail

# Drain stdin. Stop hooks can receive a JSON event body; we ignore it.
cat >/dev/null 2>&1 || true

if [[ "${HARNESS_STATE_DISABLED:-0}" == "1" ]]; then
  exit 0
fi

ROLE="${HARNESS_SESSION_ROLE:-}"
[[ -z "$ROLE" ]] && exit 0

STATE_DIR="${HARNESS_STATE_DIR:-${CLAUDE_PROJECT_DIR:-.}/.githarness/state}"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
touch "$STATE_DIR/${ROLE}.last-stop" 2>/dev/null || true

exit 0
