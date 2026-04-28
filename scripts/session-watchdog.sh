#!/usr/bin/env bash
# session-watchdog — Tier 2 event polling for long-lived harness sessions.
#
# Problem it solves:
#   Tier 1 (Stop hook) only fires when a session tries to exit. If a
#   session ends its response and sits idle, nothing triggers another
#   turn. The watchdog is an external polling process that notices when
#   GitHub state produces work for a role and pokes that role's tmux
#   session via send-keys.
#
# Design principle — harness is label-schema-agnostic:
#   The watchdog does NOT know what P0/P1/... mean or which labels are
#   priority vs area. It defers all such judgments to the session by
#   calling scripts/session-next-issue.sh and forwarding the counts.
#   The session reads its project's CLAUDE.md, picks an order, and acts.
#
# Roles:
#   The watchdog polls every role in $HARNESS_ROLES (space-separated;
#   default "planner generator evaluator"). Each role name is treated as opaque —
#   there's no special logic per role here. Role-specific behaviour
#   lives entirely in the session's CLAUDE.md.
#
# Run:
#   nohup ./scripts/session-watchdog.sh > /tmp/harness-watchdog.log 2>&1 &
# Stop:
#   pkill -f session-watchdog.sh
# Logs:
#   tail -f /tmp/harness-watchdog.log
# State:
#   cat /tmp/harness-watchdog/state.json
#
# Env:
#   HARNESS_REPO                 (required) e.g. "org/project"
#   HARNESS_ROLES                space-separated roles (default "planner generator evaluator")
#   HARNESS_WATCHDOG_INTERVAL    polling interval in seconds (default 60)
#   HARNESS_WATCHDOG_STATE_DIR   state dir (default /tmp/harness-watchdog)
#   HARNESS_WATCHDOG_STUCK_MAX   consecutive same-signature wakes before cooldown (default 3)
#   HARNESS_WATCHDOG_STUCK_COOLDOWN  seconds to wait before refresh-waking a stuck role (default 600)
#   HARNESS_FORCE_HANDOFF_MAX    consecutive failed force-handoff attempts before pane respawn (default 5)
#   HARNESS_WATCHDOG_ONESHOT     "1" runs one cycle and exits (testing)
#   HARNESS_CONTEXT_TOKEN_LIMIT_K  T0 context overflow token threshold (default 150)
#   HARNESS_CONTEXT_MINUTE_LIMIT   T0 context overflow minute threshold (default 90)
#   HARNESS_STATE_DIR            where hook state files live (default
#                                <repo>/.githarness/state); watchdog reads
#                                <role>.last-activity / <role>.last-stop mtimes
#   HARNESS_BUSY_FRESH_SECS      last-activity newer than this = agent truly
#                                busy, skip wake (default 300 = 5m)
#   HARNESS_BUSY_ESCAPE_SECS     stale but alive: send Escape to interrupt
#                                hung TUI (default 600 = 10m). The pinned
#                                `esc to interrupt` badge accepts Escape
#                                even when send-keys Enter is queued.
#   HARNESS_BUSY_RESPAWN_SECS    last-activity older than this while still
#                                flagged busy-in-file = pane is dead;
#                                respawn it (default 900 = 15m)
#   HARNESS_WORKTREE_<role>      override worktree path per role
#                                e.g. HARNESS_WORKTREE_GENERATOR=/path/to/project-generator
set -uo pipefail

REPO="${HARNESS_REPO:?HARNESS_REPO required (e.g. org/project)}"
ROLES="${HARNESS_ROLES:-planner generator evaluator}"
export ROLES
INTERVAL="${HARNESS_WATCHDOG_INTERVAL:-60}"
STATE_DIR="${HARNESS_WATCHDOG_STATE_DIR:-/tmp/harness-watchdog}"
STUCK_MAX="${HARNESS_WATCHDOG_STUCK_MAX:-3}"
ONESHOT="${HARNESS_WATCHDOG_ONESHOT:-0}"
HARNESS_CONTEXT_TOKEN_LIMIT_K="${HARNESS_CONTEXT_TOKEN_LIMIT_K:-150}"
HARNESS_CONTEXT_MINUTE_LIMIT="${HARNESS_CONTEXT_MINUTE_LIMIT:-90}"
HARNESS_BUSY_FRESH_SECS="${HARNESS_BUSY_FRESH_SECS:-300}"
HARNESS_BUSY_ESCAPE_SECS="${HARNESS_BUSY_ESCAPE_SECS:-600}"
HARNESS_BUSY_RESPAWN_SECS="${HARNESS_BUSY_RESPAWN_SECS:-900}"

mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/state.json"
[[ -f "$STATE_FILE" ]] || echo '{"wake_history": {}, "retries": {}}' > "$STATE_FILE"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_BASENAME="$(basename "$ROOT")"
NEXT_SCRIPT="$ROOT/scripts/session-next-issue.sh"
HARNESS_STATE_DIR="${HARNESS_STATE_DIR:-$ROOT/.githarness/state}"
export HARNESS_STATE_DIR

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

# Session/pane addressing.
#
# githarness v0.2 layout: one outer tmux session "$HARNESS_TMUX_SESSION"
# (default "harness-<REPO_BASENAME>") with four panes on window
# "harness":
#   0 = planner, 1 = generator, 2 = evaluator, 3 = watchdog log tail
#
# Legacy fallback: if HARNESS_TMUX_SESSION is unset AND there is a
# dedicated session whose name equals the role, target that session.
# This keeps Heimdal-style multi-session layouts working while the
# canonical init path uses the 4-pane model.
TMUX_SESSION_DEFAULT="harness-$(basename "$(cd "$(dirname "$0")/.." && pwd)")"
HARNESS_TMUX_SESSION="${HARNESS_TMUX_SESSION:-$TMUX_SESSION_DEFAULT}"

pane_for_role() {
  local role="$1"
  local env_name
  env_name="HARNESS_PANE_$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  local idx="${!env_name:-}"
  if [[ -z "$idx" ]]; then
    case "$role" in
      planner)   idx=0 ;;
      generator) idx=1 ;;
      evaluator) idx=2 ;;
      *)         idx="" ;;
    esac
  fi
  echo "$idx"
}

# Resolve a pane target usable with tmux -t. Prefers the 4-pane model;
# falls back to a per-role session when no pane index is known.
target_for_role() {
  local role="$1"
  local idx
  idx=$(pane_for_role "$role")
  if [[ -n "$idx" ]] && tmux has-session -t "$HARNESS_TMUX_SESSION" 2>/dev/null; then
    echo "${HARNESS_TMUX_SESSION}:harness.${idx}"
    return 0
  fi
  # Legacy: one-session-per-role.
  echo "$role"
}

has_session() {
  local role="$1"
  local idx
  idx=$(pane_for_role "$role")
  if [[ -n "$idx" ]] && tmux has-session -t "$HARNESS_TMUX_SESSION" 2>/dev/null; then
    # Pane exists if the window has at least idx+1 panes.
    local pane_count
    pane_count=$(tmux list-panes -t "${HARNESS_TMUX_SESSION}:harness" 2>/dev/null | wc -l)
    [[ "$pane_count" -gt "$idx" ]]
    return
  fi
  tmux has-session -t "$role" 2>/dev/null
}

# State-file helpers. Claude Code hooks (harness-state-activity.sh on
# PreToolUse, harness-state-stop.sh on Stop) touch empty files whose
# mtimes encode "last time this role ran a tool" and "last time this
# role ended a turn". The watchdog reads those mtimes to decide busy
# vs. idle without scraping the TUI.
#
# Previous (v0.2.23~v0.2.25) approach scraped tmux capture-pane output
# for spinner glyphs and thinking verbs. Two observed failures:
#   1. `✻ Worked for 5m 57s` (past-tense end-of-turn marker) matched
#      the `(ing|ed|…)` regex and kept idle panes flagged busy
#      forever → wake never sent → v0.2.25 deadlock.
#   2. Hot-deal generator 2026-04-27 11:15Z: `esc to interrupt` pinned
#      for 53 minutes while no tool actually ran (Claude Code CLI
#      stall). Scrape-based busy check said "busy, skip"; mtime-based
#      would have said "last-activity > 5m stale, fallback wake".
state_mtime() {
  local file="$1"
  [[ -f "$file" ]] || { echo 0; return 0; }
  stat -c %Y "$file" 2>/dev/null || echo 0
}

# Returns one of: idle, busy, stale-send, stale-escape, stale-respawn
# on stdout. Stdout consumers switch on the word; no exit-code games.
#
#   idle          — last-stop >= last-activity (turn cleanly ended,
#                   or no activity yet). Normal wake path.
#   busy          — activity newer than stop AND activity fresh
#                   (< HARNESS_BUSY_FRESH_SECS). Agent is running a
#                   tool, skip this cycle.
#   stale-send    — activity ahead of stop, age ≥ FRESH but < ESCAPE.
#                   Queue a wake via send-keys; if the TUI is just
#                   missing a Stop event, the next turn will absorb
#                   the queued message.
#   stale-escape  — activity ahead of stop, age ≥ ESCAPE but < RESPAWN.
#                   Caller sends Escape to interrupt the stuck turn,
#                   then a wake. Confirmed working on the pinned
#                   `esc to interrupt` badge.
#   stale-respawn — activity ahead of stop, age ≥ RESPAWN. Escape
#                   did not recover; pane is effectively dead.
#
# Callers should ALSO honor has_session() (pane gone = restart) and
# is_session_awaiting_human_input() (operator typing = skip everything).
session_busy_state() {
  local role="$1"
  if ! has_session "$role"; then
    echo "idle"  # no session = not busy; caller decides restart
    return 0
  fi
  local activity_file stop_file now act stop age idx pane_pid pane_start
  activity_file="$HARNESS_STATE_DIR/${role}.last-activity"
  stop_file="$HARNESS_STATE_DIR/${role}.last-stop"
  act=$(state_mtime "$activity_file")
  stop=$(state_mtime "$stop_file")

  # Pane-respawn guard: activity/stop mtimes that predate the current
  # claude process are from a previous incarnation. A respawned pane
  # inherits its predecessor's state files on disk; without this
  # check, the new process is reported "busy" based on its
  # predecessor's final pre-death activity touch — forever, because
  # the new process never touches the files until it gets its first
  # wake, and the watchdog refuses to wake a "busy" pane. Net:
  # post-respawn silent deadlock.
  idx=$(pane_for_role "$role")
  if [[ -n "$idx" ]] && tmux has-session -t "$HARNESS_TMUX_SESSION" 2>/dev/null; then
    pane_pid=$(tmux list-panes -t "${HARNESS_TMUX_SESSION}:harness" -F '#{pane_index} #{pane_pid}' 2>/dev/null \
      | awk -v i="$idx" '$1==i {print $2; exit}')
    if [[ -n "$pane_pid" && -e "/proc/$pane_pid/stat" ]]; then
      pane_start=$(stat -c %Y "/proc/$pane_pid/stat" 2>/dev/null || echo 0)
      if [[ "$pane_start" -gt 0 ]]; then
        # Discard pre-respawn mtimes.
        [[ "$act" -gt 0 && "$act" -lt "$pane_start" ]] && act=0
        [[ "$stop" -gt 0 && "$stop" -lt "$pane_start" ]] && stop=0
      fi
    fi
  fi

  # No activity yet ever, or stop newer than last activity → idle.
  if [[ "$act" -eq 0 || "$stop" -ge "$act" ]]; then
    echo "idle"
    return 0
  fi
  now=$(date -u +%s)
  age=$(( now - act ))
  if [[ "$age" -lt "$HARNESS_BUSY_FRESH_SECS" ]]; then
    echo "busy"
  elif [[ "$age" -lt "$HARNESS_BUSY_ESCAPE_SECS" ]]; then
    echo "stale-send"
  elif [[ "$age" -lt "$HARNESS_BUSY_RESPAWN_SECS" ]]; then
    echo "stale-escape"
  else
    echo "stale-respawn"
  fi
}

# Back-compat shim: is_session_busy returns 0 (true) if the role is in
# the "busy" state (tool call in flight, < FRESH age). STALE states
# return 1 so callers proceed with wake/escape/respawn. Callers that
# need finer granularity call session_busy_state directly.
is_session_busy() {
  local st
  st=$(session_busy_state "$1")
  [[ "$st" == "busy" ]]
}

# Human-input check — returns 0 (true) if the operator appears to be
# composing a message in this role's pane.
#
# Rationale: in this harness the operator DOES talk directly to agent
# panes (design, not antipattern). If the watchdog fires a wake
# send-keys while the operator has a half-typed message in the
# prompt box, Claude Code concatenates the two — the operator's text
# becomes a prefix of the watchdog's wake message, prompts collide,
# and the result is incoherent input. Worse, the operator's
# intended message is then invisible to them (already submitted as
# part of the wake body).
#
# Signals that a human is typing:
#   • Footer contains the input-box character `❯ ` followed by any
#     non-whitespace character (the input box is non-empty)
#   • A recent paste marker `[Pasted text ...]` appears in the
#     input box area
#   • The footer prompt-area shows the composing cursor indicator
#     (Claude CLI renders `⏵⏵ bypass permissions on` steady, but if
#     the operator just pressed keys the LAST line will be the
#     input-box row, not the bypass footer)
#
# Best effort — false negatives are fine (we fall through to wake);
# false positives just skip one wake cycle which is cheap. The
# safer default is "skip wake when unsure the human isn't typing".
is_session_awaiting_human_input() {
  local role="$1"
  has_session "$role" || return 1
  local tail target
  target=$(target_for_role "$role")
  # Capture the last 8 lines — the input box spans 3-4 lines in a
  # typical terminal (top border, prompt row, bottom border, footer).
  tail=$(tmux capture-pane -t "$target" -p 2>/dev/null | tail -8 || true)
  [[ -z "$tail" ]] && return 1
  # Look for a non-empty input line: `❯` followed by at least one
  # non-space character on the same line.
  if echo "$tail" | grep -qE '❯[[:space:]]+[^[:space:]]'; then
    return 0
  fi
  # Recent paste marker indicates the operator just dropped text into
  # the box and hasn't submitted yet.
  if echo "$tail" | grep -qE '\[Pasted text \+[0-9]+ lines\]'; then
    return 0
  fi
  return 1
}

# Handoff-in-progress check. While a role is self-handing-off to a
# successor pane, the two panes are in a direct tmux dialogue and must
# not be interrupted by external wakes. perform-handoff.sh raises
# .githarness/handoff-in-progress; handoff-finalize.sh drops it.
handoff_in_progress() {
  [[ -f "$ROOT/.githarness/handoff-in-progress" ]]
}

# Resolve worktree path for a role. Convention: sibling dir named
# "<repo>-<role>". Override via HARNESS_WORKTREE_<ROLE_UPPER>.
worktree_for_role() {
  local role="$1"
  local env_name="HARNESS_WORKTREE_$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  local override="${!env_name:-}"
  if [[ -n "$override" ]]; then
    echo "$override"
  else
    echo "$(cd "$ROOT/.." && pwd)/${REPO_BASENAME}-${role}"
  fi
}

# Restart a dead tmux session for a role. The bootstrap prompt is
# intentionally minimal — the session reads CLAUDE.md for anything
# role-specific.
restart_session() {
  local role="$1"
  local worktree idx target
  worktree=$(worktree_for_role "$role")
  if [[ ! -d "$worktree" ]]; then
    log "restart_session: worktree $worktree missing for role $role — skipping"
    return 1
  fi
  idx=$(pane_for_role "$role")
  # Fresh short-id on every respawn so the GitHub audit trail shows
  # which wake produced which artifact. Format matches lib/tmux-layout.js.
  local short_id
  short_id="${role:0:3}-$(printf '%x' "$(date -u +%s)")"
  # All env + --settings posture lives in scripts/session-launch.sh
  # (package-static, copied into every worktree by init). Same
  # launcher used by lib/tmux-layout.js — single source of truth.
  local launch_cmd
  launch_cmd="HARNESS_SESSION_ROLE=$role HARNESS_REPO=$REPO HARNESS_SESSION_SHORT_ID=$short_id HARNESS_AUTONOMY=${HARNESS_AUTONOMY:-full-auto} HARNESS_OPERATOR_LEVEL=${HARNESS_OPERATOR_LEVEL:-default} HARNESS_CLOUD=${HARNESS_CLOUD:-aws} HARNESS_DEPLOY_MODE=${HARNESS_DEPLOY_MODE:-local-only} HARNESS_STATE_DIR='$HARNESS_STATE_DIR' HARNESS_LANGUAGE=${HARNESS_LANGUAGE:-en} HARNESS_TZ=${HARNESS_TZ:-UTC} ./scripts/session-launch.sh"
  if [[ -n "$idx" ]] && tmux has-session -t "$HARNESS_TMUX_SESSION" 2>/dev/null; then
    # 4-pane model: respawn the pane in place rather than a new session.
    target="${HARNESS_TMUX_SESSION}:harness.${idx}"
    log "restarting pane: $target (role=$role short-id=$short_id cwd: $worktree)"
    tmux respawn-pane -k -t "$target" -c "$worktree" "$launch_cmd" || {
      log "failed to respawn pane $target"
      return 1
    }
  else
    # Legacy fallback: per-role session.
    log "restarting tmux session: $role (short-id=$short_id cwd: $worktree)"
    tmux new -d -s "$role" -c "$worktree" "$launch_cmd" || {
      log "failed to start tmux session $role"
      return 1
    }
    target="$role"
  fi
  sleep 8
  local bootstrap
  bootstrap="role=$role restarted. First: git fetch && git pull --rebase origin latest. Read CLAUDE.md (shared discipline) and prompts/$role.md (your role prompt) in full — both are authoritative. Before picking up new work, check in-flight state per CLAUDE.md (git stash, wip: commits, claim:$role labels, your own PRs with rework headers). If nothing is in-flight, consult ./scripts/session-next-issue.sh and apply the priority rules from prompts/$role.md. End the turn when idle; the watchdog will wake you on the next signal. Do not type /exit."
  tmux send-keys -t "$target" "$bootstrap" && sleep 1 && tmux send-keys -t "$target" Enter
  log "session $role bootstrap sent"
}

# Send a wake message to a role's tmux session, or restart if dead.
#
# wake_key deduplicates: same key N cycles in a row → enter STUCK cooldown.
# Cooldown is time-based, not permanent: after HARNESS_WATCHDOG_STUCK_COOLDOWN
# seconds (default 600 = 10 min) we wake the role again and append a
# "check for upstream updates (git fetch && git pull --rebase origin latest)"
# hint. Rationale: a session can legitimately be idle on an unchanged signal
# vector for a long time, but the outside world (merges, new issues, new
# hook/prompt versions on `latest`) does change. A permanent skip would
# deadlock the role whenever the operator merges discipline updates to
# `latest` while a session sits on an unchanged signal — it would never
# get a wake to pull them in.
wake_or_restart() {
  local role="$1" reason="$2" wake_key="$3"
  local prev_key prev_count prev_at_iso prev_at_epoch now_epoch elapsed
  local prev_pane_pid current_pane_pid idx
  prev_key=$(jq -r ".wake_history[\"$role\"].key // \"\"" "$STATE_FILE")
  prev_count=$(jq -r ".wake_history[\"$role\"].count // 0" "$STATE_FILE")
  prev_at_iso=$(jq -r ".wake_history[\"$role\"].at // \"\"" "$STATE_FILE")
  prev_pane_pid=$(jq -r ".wake_history[\"$role\"].pane_pid // \"\"" "$STATE_FILE")

  # Current pane PID — changes on every respawn. If the previously-
  # recorded pid doesn't match, the pane has been replaced (e.g. by
  # `githarness update` or watchdog respawn) and the old cooldown
  # counter no longer reflects the current process. Reset counts so
  # a fresh pane gets fresh wakes even when the GitHub signal
  # signature has not changed. Without this, a respawned pane that
  # inherits a STUCK signature sits in cooldown forever.
  idx=$(pane_for_role "$role")
  current_pane_pid=""
  if [[ -n "$idx" ]] && tmux has-session -t "$HARNESS_TMUX_SESSION" 2>/dev/null; then
    current_pane_pid=$(tmux list-panes -t "${HARNESS_TMUX_SESSION}:harness" -F '#{pane_index} #{pane_pid}' 2>/dev/null \
      | awk -v i="$idx" '$1==i {print $2; exit}')
  fi

  local cooldown_secs="${HARNESS_WATCHDOG_STUCK_COOLDOWN:-600}"
  local in_cooldown=0

  if [[ -n "$current_pane_pid" && -n "$prev_pane_pid" && "$current_pane_pid" != "$prev_pane_pid" ]]; then
    # Pane respawned since last wake — reset STUCK counter regardless
    # of signature. The new process has not seen any of the previous
    # wakes.
    log "pane-respawn detected for $role (pid $prev_pane_pid → $current_pane_pid); resetting STUCK counter"
    prev_count=0
    prev_key=""
  fi

  if [[ "$prev_key" == "$wake_key" ]]; then
    if [[ "$prev_count" -ge "$STUCK_MAX" ]]; then
      if [[ -n "$prev_at_iso" ]]; then
        prev_at_epoch=$(date -u -d "$prev_at_iso" +%s 2>/dev/null || echo 0)
      else
        prev_at_epoch=0
      fi
      now_epoch=$(date -u +%s)
      elapsed=$(( now_epoch - prev_at_epoch ))
      if [[ "$elapsed" -lt "$cooldown_secs" ]]; then
        log "STUCK: $role stuck on '$wake_key' for $prev_count attempts; cooldown $elapsed/${cooldown_secs}s. skipping this cycle."
        # v0.2.40: return 0 (not 1) — STUCK cooldown is a normal
        # throttle path, not an error. Previously return 1 leaked
        # through run_cycle's for-loop and triggered a noisy
        # "cycle error (continuing)" log on every STUCK skip,
        # masking real errors. The skip itself is logged above.
        return 0
      fi
      # Cooldown elapsed — send a refresh wake with explicit pull hint.
      in_cooldown=1
      reason="$reason"$'\n\n[watchdog cooldown refresh] Same signals as last '"$prev_count"' wakes. Before re-evaluating, run: git fetch origin && git pull --rebase origin latest. Discipline files (CLAUDE.md, prompts/*, .claude/hooks/*, scripts/*) may have changed on latest while you were idle on an unchanged signal vector.'
    fi
    prev_count=$((prev_count + 1))
  else
    prev_count=1
  fi

  local tmp
  tmp=$(mktemp)
  jq --arg r "$role" --arg k "$wake_key" --argjson c "$prev_count" \
    --arg pp "$current_pane_pid" \
    '.wake_history[$r] = {key: $k, count: $c, at: now | todate, pane_pid: $pp}' \
    "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"

  if has_session "$role"; then
    local first_line target
    target=$(target_for_role "$role")
    first_line=$(echo "$reason" | head -1)

    # Pre-send re-check. Between the top-of-cycle state check (in
    # run_cycle) and this send-keys, we ran session-next-issue.sh +
    # a GitHub query — on a slow GH response that's ~10s, enough
    # time for the agent to have picked up work on its own and
    # started thinking (activity mtime bumped, now "busy"). Fire the
    # wake and it lands inside the agent's current turn.
    #
    # stale-send is allowed through (agent is stale-but-sendable, the
    # whole point of this tier). stale-escape/stale-respawn would have
    # been routed away from wake_or_restart by run_cycle; only busy
    # and operator-input-pending block at this pre-send point.
    if is_session_busy "$role"; then
      log "wake $role ABORTED (race: busy at send time) key=${wake_key}"
      return 0
    fi
    if is_session_awaiting_human_input "$role"; then
      log "wake $role ABORTED (operator input pending) key=${wake_key}"
      return 0
    fi

    if [[ "$in_cooldown" == "1" ]]; then
      log "wake $role (cooldown refresh, total=$prev_count) key=${wake_key} — ${first_line}"
    else
      log "wake $role ($prev_count/$STUCK_MAX) key=${wake_key} — ${first_line}"
    fi
    tmux send-keys -t "$target" "$reason" && sleep 1 && tmux send-keys -t "$target" Enter
  else
    log "session $role not running — restarting"
    restart_session "$role"
  fi
}

# T0: Context age check — parses the Claude Code CLI footer
# "(Xh Ym Zs · ↓ Nk tokens)" from the session's tmux scrollback and
# forces a handoff wake when thresholds are crossed. This is the only
# in-tool observation the watchdog makes; everything else is GitHub.
check_context_age() {
  local role="$1"
  if ! has_session "$role"; then
    jq -nc '{over: false, tokens_k: 0, minutes: 0, reason: "no_session"}'
    return 0
  fi
  local capture footer_line target
  target=$(target_for_role "$role")
  capture=$(tmux capture-pane -t "$target" -p -S -300 2>/dev/null || true)
  footer_line=$(echo "$capture" | grep -oE '\([0-9]+h [0-9]+m [0-9]+s · [↓↑] [0-9.]+k tokens\)|\([0-9]+m [0-9]+s · [↓↑] [0-9.]+k tokens\)|\([0-9]+s · [↓↑] [0-9.]+k tokens\)' | tail -1)
  if [[ -z "$footer_line" ]]; then
    jq -nc '{over: false, tokens_k: 0, minutes: 0, reason: "no_footer"}'
    return 0
  fi
  local h m s minutes tokens_k
  h=$(echo "$footer_line" | grep -oE '[0-9]+h' | head -1 | tr -d 'h'); h="${h:-0}"
  m=$(echo "$footer_line" | grep -oE '[0-9]+m' | head -1 | tr -d 'm'); m="${m:-0}"
  s=$(echo "$footer_line" | grep -oE '[0-9]+s' | head -1 | tr -d 's'); s="${s:-0}"
  minutes=$(( h * 60 + m + (s > 30 ? 1 : 0) ))
  tokens_k=$(echo "$footer_line" | grep -oE '[0-9.]+k tokens' | grep -oE '[0-9.]+'); tokens_k="${tokens_k:-0}"
  local over_tokens over_minutes over reason=""
  over_tokens=$(awk -v t="$tokens_k" -v l="$HARNESS_CONTEXT_TOKEN_LIMIT_K" 'BEGIN{print (t+0 >= l+0) ? 1 : 0}')
  over_minutes=$(( minutes >= HARNESS_CONTEXT_MINUTE_LIMIT ? 1 : 0 ))
  over="false"
  if [[ "$over_tokens" == "1" ]]; then
    over="true"; reason="tokens_${tokens_k}k_exceeds_${HARNESS_CONTEXT_TOKEN_LIMIT_K}k"
  elif [[ "$over_minutes" == "1" ]]; then
    over="true"; reason="minutes_${minutes}_exceeds_${HARNESS_CONTEXT_MINUTE_LIMIT}"
  fi
  jq -nc --arg o "$over" --arg tk "$tokens_k" --argjson min "$minutes" --arg r "$reason" \
    '{over: ($o == "true"), tokens_k: ($tk | tonumber), minutes: $min, reason: $r}'
}

# Forced handoff: watchdog physically invokes perform-handoff.sh in
# the target pane instead of asking the session to do it.
#
# Why force: a session already past its context budget cannot be
# trusted to understand a new prompt — the new instruction competes
# with its existing compressed state and often gets ignored. Sessions
# without the new state-machine prompt (long-lived sessions that
# started before the discipline upgrade) are especially affected:
# they do not know `perform-handoff.sh` exists, so a text message
# asking them to run it is a no-op.
#
# Safety rails:
#   • handoff-in-progress flag check — if a handoff is already
#     underway for anyone in this repo, do nothing.
#   • idle-first attempt — if the session is not busy, we inject
#     the bash command directly and trust the session's Bash tool
#     to execute it.
#   • busy fallback — if the session is mid-work we send a clearly
#     labelled reminder message and try again next cycle; we do not
#     interrupt an in-flight turn.
#   • per-pane retry budget (HARNESS_FORCE_HANDOFF_MAX, default 5):
#     after this many consecutive cycles of failed force attempts on
#     the same pane, we escalate to respawn_pane() which kills the
#     pane and starts a fresh claude in its slot. This is the
#     "last-resort" recovery for sessions stuck below the state-
#     machine threshold.
force_handoff() {
  local role="$1" reason_detail="$2"
  local wake_key="${role}:context-overflow:$(date -u +%Y%m%d%H%M)"

  # Safety: don't step on an in-progress handoff elsewhere.
  if handoff_in_progress; then
    log "CONTEXT OVERFLOW: $role ($reason_detail) — handoff already in progress, standing by"
    return 0
  fi

  if ! has_session "$role"; then
    log "CONTEXT OVERFLOW: $role ($reason_detail) — session dead, will be restarted next cycle"
    return 0
  fi

  local pane_target
  pane_target=$(target_for_role "$role")
  local force_max="${HARNESS_FORCE_HANDOFF_MAX:-5}"
  local retry_key="force_handoff:${role}"
  local retry_count
  retry_count=$(jq -r ".retries[\"$retry_key\"] // 0" "$STATE_FILE")

  if is_session_busy "$role"; then
    # Mid-turn; nudge with a short reminder and try next cycle.
    local nudge="[watchdog] CONTEXT OVERFLOW (${reason_detail}). Finish this tool call cleanly — next turn I will invoke scripts/perform-handoff.sh directly."
    log "CONTEXT OVERFLOW: $role busy — nudge sent, will force next cycle (retry=$retry_count/$force_max)"
    tmux send-keys -t "$pane_target" "$nudge" 2>/dev/null || true
    sleep 1
    tmux send-keys -t "$pane_target" Enter 2>/dev/null || true
    return 0
  fi

  retry_count=$((retry_count + 1))
  if [[ "$retry_count" -gt "$force_max" ]]; then
    log "CONTEXT OVERFLOW: $role — forced handoff failed $force_max times; escalating to pane respawn"
    respawn_pane "$role" "$reason_detail"
    # Reset retry counter after respawn.
    local tmp
    tmp=$(mktemp)
    jq --arg k "$retry_key" 'del(.retries[$k])' "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
    return 0
  fi

  # Persist retry counter so escalation threshold is consistent
  # across cycles (the JSON state file already survives watchdog
  # restarts).
  local tmp
  tmp=$(mktemp)
  jq --arg k "$retry_key" --argjson c "$retry_count" \
    '.retries = (.retries // {}) | .retries[$k] = $c' \
    "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"

  log "CONTEXT OVERFLOW: $role ($reason_detail) — invoking scripts/perform-handoff.sh directly (attempt $retry_count/$force_max)"
  # Inject the bash command. The session's Bash tool will pick this
  # up as ordinary user input on its next ready prompt.
  tmux send-keys -t "$pane_target" "bash scripts/perform-handoff.sh" 2>/dev/null || true
  sleep 1
  tmux send-keys -t "$pane_target" Enter 2>/dev/null || true
}

# Respawn: kill the pane, start a fresh claude in its place with the
# original role env. Used only when forced handoff has repeatedly
# failed (session cannot / will not cooperate). Raises the handoff
# flag briefly so other roles do not poll mid-respawn.
respawn_pane() {
  local role="$1" reason="$2"
  if ! has_session "$role"; then
    log "respawn_pane: no $role session to respawn"
    return 1
  fi
  log "respawn_pane: $role — reason=$reason"
  mkdir -p "$ROOT/.githarness"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$ROOT/.githarness/handoff-in-progress"
  # In the 4-pane model, restart_session uses `tmux respawn-pane -k`
  # which already kills + replaces the target pane. Legacy path
  # (per-role session) gets killed here before restart_session recreates.
  local idx
  idx=$(pane_for_role "$role")
  if [[ -z "$idx" ]] || ! tmux has-session -t "$HARNESS_TMUX_SESSION" 2>/dev/null; then
    tmux kill-session -t "$role" 2>/dev/null || true
  fi
  restart_session "$role"
  rm -f "$ROOT/.githarness/handoff-in-progress"
}

# Keep the old name as a thin alias for any external callers.
wake_handoff() {
  force_handoff "$@"
}

# Poll one role: call scripts/session-next-issue.sh for this role, and
# if it reports work, wake the session with a neutral message containing
# the count summary. The session decides what to do.
poll_role() {
  local role="$1"
  # Run next-issue with role env injected so it answers for this role.
  local result
  result=$(HARNESS_SESSION_ROLE="$role" HARNESS_REPO="$REPO" "$NEXT_SCRIPT" 2>/dev/null || echo '{"has_work": false, "reason": "script_error"}')
  local has_work reason
  has_work=$(echo "$result" | jq -r '.has_work // false')
  reason=$(echo "$result" | jq -r '.reason // ""')

  # Rate-limit backoff signal from session-next-issue.sh. Skip all
  # three roles this cycle and sleep until close to the reset time
  # (capped at 5 min to stay responsive to interactive operators).
  # Setting _HARNESS_BACKOFF is read by run_cycle after the per-role
  # loop so all three roles see the same decision in one cycle.
  if [[ "$reason" == "rate_limit_backoff" ]]; then
    local wait_secs
    wait_secs=$(echo "$result" | jq -r '.wait_seconds // 0')
    [[ "$wait_secs" -gt 300 ]] && wait_secs=300
    [[ "$wait_secs" -lt 30 ]] && wait_secs=30
    log "$role: rate-limit backoff (graphql remaining=$(echo "$result" | jq -r '.graphql_remaining // 0')); sleeping ${wait_secs}s"
    _HARNESS_BACKOFF="$wait_secs"
    export _HARNESS_BACKOFF
    return 0
  fi

  if [[ "$has_work" != "true" ]]; then
    log "$role: idle ($reason)"
    return 0
  fi
  # Build a stable wake signature from the counts so repeated identical
  # states don't re-wake every cycle (STUCK protection).
  local counts_sig
  counts_sig=$(echo "$result" | jq -r '.counts // {} | to_entries | sort_by(.key) | map("\(.key)=\(.value)") | join(",")')
  local wake_key="${role}:${counts_sig}"
  local summary
  summary=$(echo "$result" | jq -r '.counts // {} | to_entries | map(select(.value > 0)) | map("\(.key)=\(.value)") | join(", ")')
  local msg
  msg=$(cat <<EOF
[T2 wake] Signals present: ${summary}

Read CLAUDE.md for the priority rules that apply to role=${role}, then:
  1. Read the latest CLAUDE.md (git pull first) in case discipline changed.
  2. Call ./scripts/session-next-issue.sh yourself to see the current counts.
  3. Query GitHub directly (gh issue list / gh pr list) with the filters your role's discipline specifies — the harness does NOT hardcode your priority or label schema.
  4. Before starting any issue/PR pickup, leave a claim comment on that item: "work-start — session=<your-short-id> @ <UTC time>". If the most-recent claim comment on that item is from another session within the last 10 minutes, treat it as claimed and pick something else. This prevents double-pickup.
  5. Do the work per your role's CLAUDE.md discipline.
  6. End the turn when idle — the watchdog will wake you again on the next signal.
EOF
)
  wake_or_restart "$role" "$msg" "$wake_key"
}

check_full_regression_wake() {
  # v0.2.39: 2h cadence full-suite regression wake to evaluator.
  # The eval-merge-gate is scope-aware (only runs affected-map
  # scopes per PR) to keep per-PR latency low; this wake compensates
  # by forcing a full-matrix run every
  # HARNESS_FULL_REGRESSION_INTERVAL seconds (default 7200 = 2h).
  # The evaluator takes this wake as "run the entire suite against
  # `latest` tip + file regression issues".
  local interval_secs="${HARNESS_FULL_REGRESSION_INTERVAL:-7200}"
  local marker_file="$HARNESS_STATE_DIR/last-full-regression-wake.epoch"
  local now_epoch last_epoch elapsed
  now_epoch=$(date -u +%s)
  last_epoch=0
  [[ -f "$marker_file" ]] && last_epoch=$(cat "$marker_file" 2>/dev/null | tr -d '[:space:]' || echo 0)
  [[ -z "$last_epoch" ]] && last_epoch=0
  elapsed=$(( now_epoch - last_epoch ))
  (( elapsed < interval_secs )) && return 0

  if ! has_session evaluator; then
    return 0
  fi
  if is_session_busy evaluator; then
    log "full-regression wake: evaluator busy — deferring"
    return 0
  fi
  if is_session_awaiting_human_input evaluator; then
    return 0
  fi

  log "full-regression wake: emitting to evaluator (elapsed ${elapsed}s ≥ ${interval_secs}s)"
  local target msg
  target=$(target_for_role evaluator)
  msg=$(cat <<'EOF'
[T2 full-regression wake] 2-hour cadence full-suite regression pass.

  The per-PR merge gate runs scoped tests only (affected by the PR
  diff). This wake is the safety net: run the entire suite on the
  current `latest` tip and file any failing spec / scenario as a
  `regression` + `claim:generator` issue.

  Procedure:
    1. `git fetch origin && git checkout latest && git pull`
    2. `docker compose down -v && docker compose up -d --build`
    3. `./scripts/wait-for-healthy.sh`
    4. Run the FULL suites (override scoping):
         GATE_SCOPES="" GATE_FULL=1 ./tests/run-all.sh
         (or project-specific equivalent — Playwright all projects,
          Newman all collections, UAT all personas)
    5. Save the result as the new baseline for the FULL hash:
         bash scripts/eval-baseline-save.sh --full
       This updates tests/baseline-cache/FULL.json; any future
       eval-merge-gate --full run reads this for triage.
    6. For each NEW regression (not present 2h ago), file a
       `regression` + `claim:generator` + `priority/1` issue:
         `gh issue create --title 'regression: <spec-id>' \
            --body '<reproduction + last-green SHA>' \
            --label regression,claim:generator,priority/1`
    7. End the turn. The next merge gate will see the updated
       baseline and triage correctly.

  This wake is deliberately infrequent (2h). Do not treat it as
  a reason to pause PR review; the per-PR scoped gate continues
  independently.
EOF
)
  tmux send-keys -t "$target" "$msg" && sleep 1 && tmux send-keys -t "$target" Enter

  mkdir -p "$(dirname "$marker_file")"
  echo "$now_epoch" > "$marker_file"
}

check_refinement_wake() {
  # v0.2.38: budget guard — skip refinement wake if 24h token
  # budget was exceeded this cycle (set by run_cycle).
  if [[ "${_HARNESS_SKIP_REFINEMENT:-0}" == "1" ]]; then
    return 0
  fi
  # When every role is truly idle (no work on any counter, no
  # in-flight claim, no rework pending), the default watchdog behavior
  # is to emit "$role: idle (idle)" every cycle and send no wake. That
  # is correct for short idle stretches — the agents should not be
  # woken up for zero signals. But over hours of idleness, the pilot
  # stops advancing: the product is not "done" in any absolute sense,
  # it is just out of filed work. The planner should use that time to
  # re-scout references and raise the quality bar.
  #
  # This function fires a one-shot wake to the planner only, at most
  # once every HARNESS_REFINEMENT_WAKE_INTERVAL seconds (default 1800
  # = 30 min), when all signals are zero. The wake instructs the
  # planner to:
  #   - revisit the scouted OSS references + look for new ones,
  #   - compare the current implementation against those references,
  #   - file refinement issues (claim:generator, refinement-loop
  #     label) that raise the quality bar beyond the initial roadmap.
  # After the planner's turn the refinement marker is updated; the
  # wake does not repeat until the next interval.
  #
  # Env:
  #   HARNESS_REFINEMENT_WAKE_INTERVAL  seconds between refinement
  #                                     wakes (default 1800 = 30m)
  local interval_secs="${HARNESS_REFINEMENT_WAKE_INTERVAL:-1800}"
  local marker_file="$HARNESS_STATE_DIR/last-refinement-wake.epoch"
  local now_epoch last_epoch elapsed
  now_epoch=$(date -u +%s)
  last_epoch=0
  [[ -f "$marker_file" ]] && last_epoch=$(cat "$marker_file" 2>/dev/null | tr -d '[:space:]' || echo 0)
  [[ -z "$last_epoch" ]] && last_epoch=0
  elapsed=$(( now_epoch - last_epoch ))
  if (( elapsed < interval_secs )); then
    return 0
  fi

  # Quick check: any role has work? If yes, we are not truly idle.
  # We only emit the refinement wake when every role's
  # session-next-issue.sh returns has_work=false with a non-error
  # reason.
  local all_idle=1
  for role in $ROLES; do
    local result reason has_work
    result=$(HARNESS_SESSION_ROLE="$role" HARNESS_REPO="$REPO" "$NEXT_SCRIPT" 2>/dev/null || echo '{"has_work": false, "reason": "script_error"}')
    has_work=$(echo "$result" | jq -r '.has_work // false')
    reason=$(echo "$result" | jq -r '.reason // ""')
    if [[ "$has_work" == "true" ]]; then
      all_idle=0
      break
    fi
    # Error reasons (script_error, graphql_error, rate_limit_backoff)
    # are NOT idle — they are unknown. Do not fire refinement wake.
    if [[ "$reason" != "idle" && "$reason" != "no_role" ]]; then
      all_idle=0
      break
    fi
  done

  if (( all_idle == 0 )); then
    return 0
  fi

  # Emit refinement wake to planner only. Generator and evaluator
  # stay idle — they will naturally wake on the next cycle if the
  # planner files new work.
  if ! has_session planner; then
    return 0
  fi
  if is_session_busy planner; then
    log "refinement wake: planner busy — deferring to next eligible cycle"
    return 0
  fi
  if is_session_awaiting_human_input planner; then
    log "refinement wake: planner has operator input pending — deferring"
    return 0
  fi

  log "refinement wake: emitting to planner (elapsed ${elapsed}s ≥ ${interval_secs}s since last; all roles idle)"

  local planner_target msg
  planner_target=$(target_for_role planner)
  msg=$(cat <<EOF
[T2 refinement wake] All roles idle — no open issues, no PRs, no rework. Use this turn to raise the quality bar before more work is filed.

  1. Re-scout OSS references: revisit the references cited at bootstrap and look for newer / higher-quality alternatives. Clone and code-explore up to 3 new candidates under .githarness/ingested/ if warranted.
  2. Compare current implementation against the best-in-class reference: where is our product behind? (UX polish, data-source breadth, edge-case handling, performance, accessibility, i18n, observability, error states, mobile experience).
  3. File refinement issues as claim:generator with priority/<N> labels. Use the label 'refinement-loop' on every issue you file in this turn so the operator can tell them apart from bootstrap-roadmap issues.
  4. Acceptance criteria on every refinement issue MUST be Given/When/Then scenarios per skills/for-all-roles/bdd-acceptance-scenarios.md — the quality bar applies to the AC format, not just the code.
  5. End the turn normally; the next refinement wake is ${interval_secs}s away, but if the generator/evaluator drain the new backlog before that, you will be woken earlier via normal signal-based wake.

This wake is deliberately infrequent (${interval_secs}s cadence). It exists so the loop keeps improving the product even after the operator-given roadmap is drained.
EOF
)
  tmux send-keys -t "$planner_target" "$msg" && sleep 1 && tmux send-keys -t "$planner_target" Enter

  mkdir -p "$(dirname "$marker_file")"
  echo "$now_epoch" > "$marker_file"
}

check_vision_fallback() {
  # If the planner has posted its Phase 1 prompt but no vision has
  # been captured within HARNESS_VISION_WAIT_MINUTES (default 10),
  # raise a flag file so the planner's next wake enters Infer-vision
  # mode and the loop does not stall on operator silence.
  # v0.2.34: these files live under HARNESS_STATE_DIR (main-clone
  # path, gitignored) so planner writing from its own worktree and
  # watchdog reading from main clone agree without tracking markers
  # in git. Falls back to the pre-v0.2.34 cwd-relative path if the
  # new file is absent but the legacy one is present.
  local posted_at_file="${HARNESS_STATE_DIR:-$ROOT/.githarness/state}/phase1-posted-at.iso8601"
  local vision_file="${HARNESS_STATE_DIR:-$ROOT/.githarness/state}/vision.txt"
  local flag_file="${HARNESS_STATE_DIR:-$ROOT/.githarness/state}/vision-fallback"
  [[ ! -f "$posted_at_file" && -f "$ROOT/.githarness/phase1-posted-at.iso8601" ]] && \
    posted_at_file="$ROOT/.githarness/phase1-posted-at.iso8601"
  [[ ! -f "$vision_file" && -f "$ROOT/.githarness/vision.txt" ]] && \
    vision_file="$ROOT/.githarness/vision.txt"
  [[ -f "$posted_at_file" ]] || return 0
  [[ -f "$vision_file" ]] && return 0
  [[ -f "$flag_file" ]] && return 0
  local posted_at_iso posted_at_epoch now_epoch elapsed wait_min
  posted_at_iso=$(cat "$posted_at_file" 2>/dev/null | tr -d '[:space:]')
  [[ -n "$posted_at_iso" ]] || return 0
  posted_at_epoch=$(date -u -d "$posted_at_iso" +%s 2>/dev/null || echo 0)
  now_epoch=$(date -u +%s)
  elapsed=$(( now_epoch - posted_at_epoch ))
  wait_min="${HARNESS_VISION_WAIT_MINUTES:-10}"
  if (( elapsed >= wait_min * 60 )); then
    log "VISION FALLBACK: operator silent for ${elapsed}s (>= ${wait_min}min); signaling planner to infer vision on next wake"
    mkdir -p "$(dirname "$flag_file")"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$flag_file"
  fi
}

run_cycle() {
  # Handoff in progress? The dying and fresh panes are mid-dialogue
  # via tmux send-keys; external wakes would corrupt the conversation.
  if handoff_in_progress; then
    log "handoff-in-progress flag set — skipping this cycle"
    return 0
  fi
  # Check whether Phase 1 vision capture has timed out; if so, raise
  # the fallback flag so planner enters infer-mode on its next wake.
  check_vision_fallback
  # v0.2.34: refinement-wake ladder. When every role is genuinely
  # idle, emit a one-shot wake to planner every HARNESS_REFINEMENT_WAKE_INTERVAL
  # (default 30m) instructing it to re-scout references and file
  # refinement-loop issues. Generator / evaluator stay idle; they
  # wake naturally on the next cycle if planner files new work.
  check_refinement_wake
  check_full_regression_wake
  # v0.2.38: token-ledger sample — every tick, read the Claude Code
  # session JSONL under ~/.claude/projects/<slugified-worktree>/*.jsonl
  # and append a summary row to $HARNESS_STATE_DIR/token-ledger-<role>.jsonl.
  # Precise per-turn data (input / cache_creation / cache_read / output);
  # no regex scraping of transient pane footers.
  #
  # v0.2.42: human-vibe audit — same source file, extract external-
  # origin user inputs (non-wake, non-tool_result, non-bootstrap)
  # and drop per-record JSON into
  # <main>/.githarness/audit/human-prompts/YYYYMMDD/. Idempotent via
  # per-role index under $HARNESS_STATE_DIR. This is the research-
  # grade "what external vibe did the harness receive" log.
  for role in $ROLES; do
    local wt
    wt=$(worktree_for_role "$role")
    [[ -d "$wt" ]] || continue
    bash "$ROOT/scripts/token-ledger-sample.sh" "$role" "$wt" 2>/dev/null || true
    bash "$ROOT/scripts/human-vibe-audit.sh" "$role" "$wt" 2>/dev/null || true
  done
  # Budget guard: sum the latest-per-session totals across the
  # three role ledgers, compared against HARNESS_TOKEN_BUDGET_24H_K
  # (default 5000 k = 5M tokens). A breach logs and optionally
  # suppresses refinement wake. Ledger rows carry exact counts from
  # ~/.claude/projects/.../session.jsonl, not regex estimates.
  local budget_k="${HARNESS_TOKEN_BUDGET_24H_K:-5000}"
  if [[ "$budget_k" -gt 0 ]]; then
    local total_24h_k
    total_24h_k=$(python3 -c "
import json, os, glob, datetime
now = datetime.datetime.utcnow().timestamp()
cutoff = now - 86400
total = 0
for role in os.environ.get('ROLES', 'planner generator evaluator').split():
    f = f\"{os.environ.get('HARNESS_STATE_DIR', '.')}/token-ledger-{role}.jsonl\"
    if not os.path.exists(f):
        continue
    by_session = {}
    with open(f) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            ts = datetime.datetime.strptime(r['ts'], '%Y-%m-%dT%H:%M:%SZ').timestamp()
            if ts < cutoff:
                continue
            sid = r.get('session_id', '')
            prior = by_session.get(sid, 0)
            tot = r.get('total_tokens', 0)
            if tot > prior:
                by_session[sid] = tot
    total += sum(by_session.values())
print(int(total // 1000))
" 2>/dev/null || echo 0)
    total_24h_k=${total_24h_k:-0}
    if (( total_24h_k > budget_k )); then
      log "BUDGET EXCEEDED: 24h tokens=${total_24h_k}k > budget=${budget_k}k"
      [[ "${HARNESS_BUDGET_STOP_REFINEMENT:-0}" == "1" ]] && \
        export _HARNESS_SKIP_REFINEMENT=1
    fi
  fi
  # T0: context overflow check for every role before any other wake.
  # A session past its context budget cannot be trusted to handle new
  # signals cleanly, so handoff preempts. Skip when the pane is
  # actively running a tool (busy) OR when state is stale — capture-pane
  # on a hung TUI returns a footer from an earlier turn whose (h/m/s ·
  # tokens) figures no longer reflect current context usage.
  for role in $ROLES; do
    local ctx_bstate
    ctx_bstate=$(session_busy_state "$role")
    if [[ "$ctx_bstate" == "busy" || "$ctx_bstate" == stale-* ]]; then
      log "$role ${ctx_bstate} — skip context-age check"
      continue
    fi
    if is_session_awaiting_human_input "$role"; then
      log "$role has operator input pending — skip context-age check (do not collide with human message)"
      continue
    fi
    local ctx
    ctx=$(check_context_age "$role")
    if [[ "$(echo "$ctx" | jq -r '.over')" == "true" ]]; then
      wake_handoff "$role" "$(echo "$ctx" | jq -r '.reason')"
    fi
  done
  # T2: GitHub-signal-based wake per role.
  #
  # Busy-state ladder (see session_busy_state for thresholds):
  #   busy            → skip this cycle
  #   idle            → normal wake via poll_role
  #   stale-send      → normal wake (send-keys reaches the input box;
  #                     if the turn is missing a Stop event the next
  #                     turn absorbs the queued message)
  #   stale-escape    → send Escape to interrupt the stuck turn, then
  #                     wake. Recovers the `esc to interrupt`-pinned
  #                     hang observed 2026-04-27 on hot-deal gen.
  #   stale-respawn   → pane is effectively dead; respawn
  for role in $ROLES; do
    # Operator-typing check always wins — never collide with human input.
    if is_session_awaiting_human_input "$role"; then
      log "$role has operator input pending — skip wake (operator is typing; watchdog defers)"
      continue
    fi
    local bstate
    bstate=$(session_busy_state "$role")
    case "$bstate" in
      busy)
        log "$role busy — skip wake"
        continue
        ;;
      stale-escape)
        log "STALE-ESCAPE: $role — activity ≥${HARNESS_BUSY_ESCAPE_SECS}s stale while flagged busy; sending Escape"
        local target
        target=$(target_for_role "$role")
        tmux send-keys -t "$target" Escape 2>/dev/null || true
        sleep 2
        # Freshen activity marker so the next cycle does not immediately
        # re-escalate before the agent has a chance to respond.
        touch "$HARNESS_STATE_DIR/${role}.last-activity" 2>/dev/null || true
        poll_role "$role"
        ;;
      stale-respawn)
        log "STALE-RESPAWN: $role — activity ≥${HARNESS_BUSY_RESPAWN_SECS}s stale; Escape ladder exhausted, respawning pane"
        respawn_pane "$role" "stale-${HARNESS_BUSY_RESPAWN_SECS}s"
        ;;
      idle|stale-send)
        poll_role "$role"
        ;;
    esac
  done
}

log "watchdog starting — repo=$REPO roles=[$ROLES] interval=${INTERVAL}s state=$STATE_DIR stuck_max=$STUCK_MAX"

while true; do
  unset _HARNESS_BACKOFF _HARNESS_SKIP_REFINEMENT
  run_cycle || log "cycle error (continuing)"
  [[ "$ONESHOT" == "1" ]] && { log "oneshot mode — exiting"; exit 0; }
  # If poll_role signaled rate-limit backoff, sleep the longer of
  # INTERVAL and the reset-wait (capped inside poll_role at 300s).
  # This turns the loop from "storm until quota resets" into
  # "sleep through the drought".
  sleep_for="$INTERVAL"
  if [[ -n "${_HARNESS_BACKOFF:-}" && "$_HARNESS_BACKOFF" -gt "$sleep_for" ]]; then
    sleep_for="$_HARNESS_BACKOFF"
    log "sleeping ${sleep_for}s (rate-limit backoff, next cycle after reset window)"
  fi
  sleep "$sleep_for"
done
