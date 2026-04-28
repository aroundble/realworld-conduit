#!/usr/bin/env bash
# harness-state-activity — PreToolUse hook.
#
# Records "this role is alive and running a tool" by touching a
# per-role mtime file. The watchdog compares this against the
# matching last-stop mtime to decide whether the role is busy or
# idle. This replaces scraping the Claude Code TUI footer, which
# broke on two observed edge cases:
#
#   1. Turn-ended text with a past-tense spinner line like
#      `✻ Worked for 5m 57s` — the v0.2.23 busy regex matched the
#      `-ed` suffix and kept reporting the idle role as busy, so
#      no wake was ever sent (deadlock, v0.2.25).
#   2. Claude Code CLI stuck with `esc to interrupt` pinned to the
#      footer while no tool call actually ran for >50 minutes
#      (observed 2026-04-27 on hot-deal generator, PR #12).
#
# Semantics:
#   - PreToolUse fires just before every tool invocation. Touching
#     on Pre (not Post) keeps the signal fresh even when the tool
#     itself hangs — the watchdog sees "alive 30s ago" and waits,
#     but once activity goes stale by HARNESS_WATCHDOG_BUSY_FRESH
#     (default 5m), fallback wake fires.
#   - Fail-open. This hook MUST NOT block a tool call. Any error
#     in the mkdir/touch path is swallowed; the watchdog falls back
#     to "role treated as idle after 5m".
#
# Env:
#   HARNESS_SESSION_ROLE         required — per-role mtime file name
#   HARNESS_STATE_DIR            default: ${CLAUDE_PROJECT_DIR}/.githarness/state
#   CLAUDE_PROJECT_DIR           provided by Claude Code
#   HARNESS_STATE_DISABLED=1     disable the hook entirely
#
# State file:
#   ${HARNESS_STATE_DIR}/${role}.last-activity    (mtime-only; empty content)

set -uo pipefail

# Always drain stdin so Claude Code does not block the tool call.
cat >/dev/null 2>&1 || true

if [[ "${HARNESS_STATE_DISABLED:-0}" == "1" ]]; then
  exit 0
fi

ROLE="${HARNESS_SESSION_ROLE:-}"
[[ -z "$ROLE" ]] && exit 0  # ad-hoc session — no state tracking

STATE_DIR="${HARNESS_STATE_DIR:-${CLAUDE_PROJECT_DIR:-.}/.githarness/state}"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
touch "$STATE_DIR/${ROLE}.last-activity" 2>/dev/null || true

exit 0
