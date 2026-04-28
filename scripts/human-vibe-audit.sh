#!/usr/bin/env bash
# human-vibe-audit — scan a role's Claude Code session JSONL and
# append any external-origin user input to the pilot's audit trail.
#
# "External-origin" = every user-type record that is NOT a hook
# wake. The harness posts wakes via Stop hook (`Stop hook feedback:
# ...`) and the watchdog (`[T2 wake] ...`, `[T2 refinement wake]`,
# `[T2 full-regression wake]`). Everything else in the user record
# stream came from outside the automation loop — that is the
# "human vibe" injected into the harness.
#
# Caller-origin (operator typing directly vs observer running
# `tmux paste-buffer`) is NOT tracked. From the project's
# perspective, any non-hook user record is external vibe.
#
# Cross-role comments (`[<role> @ <short-id>]`) and tool_result
# records are also excluded. The former is inter-agent talk in the
# GitHub comment stream captured as a pane input; the latter is
# obvious.
#
# Output: .githarness/audit/human-prompts/YYYYMMDD/HHMMSS-<role>-<session>-<seq>.json
# Per-record JSON with timestamp, role, session_id, seq, content,
# preceding wake context, and the first tool call after. The
# preceding-wake-context lets a researcher distinguish "cold
# external interaction" from "response to a specific wake message".
#
# Idempotent: a seen-records ledger at
# $HARNESS_STATE_DIR/audited-record-index-<role>.txt tracks which
# JSONL offsets have been processed, so repeated runs do not
# duplicate.
#
# Usage (invoked by the watchdog):
#   bash scripts/human-vibe-audit.sh <role> <worktree>
#
# Env:
#   HARNESS_STATE_DIR   where the per-role index lives

set -uo pipefail

ROLE="${1:-}"
WORKTREE="${2:-}"
[[ -z "$ROLE" || -z "$WORKTREE" ]] && exit 0
[[ ! -d "$WORKTREE" ]] && exit 0

# The audit output dir lives in the MAIN clone, not the worktree.
# Worktree is a siblings-dir convention (<main>-<role>), so main is
# the parent dir minus the "-<role>" suffix. We resolve it by
# ascending one dir and stripping.
MAIN_CLONE=$(dirname "$WORKTREE")
REPO_BASENAME=$(basename "$WORKTREE" | sed "s/-${ROLE}\$//")
MAIN_CLONE="$MAIN_CLONE/$REPO_BASENAME"
[[ ! -d "$MAIN_CLONE/.githarness" ]] && {
  # Fallback: write into the worktree's own .githarness.
  MAIN_CLONE="$WORKTREE"
}

AUDIT_BASE="$MAIN_CLONE/.githarness/audit/human-prompts"
STATE_DIR="${HARNESS_STATE_DIR:-$MAIN_CLONE/.githarness/state}"
mkdir -p "$AUDIT_BASE" "$STATE_DIR" 2>/dev/null || exit 0

INDEX_FILE="$STATE_DIR/audited-record-index-${ROLE}.txt"
touch "$INDEX_FILE" 2>/dev/null || exit 0

# Slug: absolute path with / → -
slug=$(echo "$WORKTREE" | sed 's|/|-|g')
proj_dir="$HOME/.claude/projects/$slug"
[[ ! -d "$proj_dir" ]] && exit 0

python3 - "$proj_dir" "$AUDIT_BASE" "$INDEX_FILE" "$ROLE" <<'PY'
import json
import os
import re
import sys
from pathlib import Path
from datetime import datetime

proj_dir = Path(sys.argv[1])
audit_base = Path(sys.argv[2])
index_file = Path(sys.argv[3])
role = sys.argv[4]

WAKE_STOP = re.compile(r'^Stop hook feedback:')
WAKE_T2 = re.compile(r'^\[T2 ')
WAKE_UPDATE = re.compile(r'^\[(harness update|githarness update)\]')
WAKE_WAKE = re.compile(r'^\[wake\]')
WAKE_RESTART = re.compile(r'^role=\w+ restarted\.')
# Pre-v0.2.21 bootstrap message at init. Ceremonial, not human vibe.
INIT_BOOTSTRAP = re.compile(r"^You have just been bootstrapped by 'githarness init'\.")
# Claude Code emits this at context-continuation. System, not human.
CONTEXT_CONTINUE = re.compile(r'^This session is being continued from a previous conversation')
# Role-badge — accept both with space and @ variants.
ROLE_BADGE = re.compile(r'^\[\s*[a-z]+\s*@?\s*[a-z]+-[a-z0-9]{4,8}')
# Cross-role comment variants written in prose.
OBSERVER_NOTE = re.compile(r'^Observer note from [a-z]+-[a-z0-9]+')
# Cross-role routing — "[from evaluator pane] ..." / "[evaluator → planner] ..."
# These appear when one role is forwarding information to another role's pane.
CROSS_ROUTE = re.compile(r'^\[(from \w+ pane\]|[a-z]+ → [a-z]+[,\]])')
# Observer probe messages inserted while diagnosing a pane.
OBSERVER_PROBE = re.compile(r'^\[observer probe ')
# Claude Code UI interrupt marker (user hit Ctrl-C / escape).
USER_INTERRUPT = re.compile(r'^\[Request interrupted by user\]')

# Load seen-record index. Format per line: <session_id>:<uuid>
seen = set()
if index_file.exists():
    for line in index_file.read_text().splitlines():
        if ':' in line:
            seen.add(line.strip())

def extract_text(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ''
    parts = []
    for c in content:
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, dict):
            if c.get('type') == 'text':
                parts.append(c.get('text', ''))
            elif c.get('type') == 'tool_result':
                parts.append('__tool_result__')
    return '\n'.join(parts)

def classify(text):
    if not text or text.strip() == '':
        return 'empty'
    if text == '__tool_result__' or text.startswith('__tool_result__'):
        return 'tool_result'
    if WAKE_STOP.match(text):
        return 'wake_stop'
    if WAKE_T2.match(text):
        return 'wake_t2'
    if WAKE_UPDATE.match(text):
        return 'harness_update'
    if WAKE_WAKE.match(text):
        return 'wake_simple'
    if WAKE_RESTART.match(text):
        return 'pane_restart_bootstrap'
    if INIT_BOOTSTRAP.match(text):
        return 'init_bootstrap'
    if CONTEXT_CONTINUE.match(text):
        return 'context_continuation'
    if OBSERVER_NOTE.match(text):
        return 'cross_role'
    if CROSS_ROUTE.match(text):
        return 'cross_role'
    if OBSERVER_PROBE.match(text):
        return 'observer_probe'
    if USER_INTERRUPT.match(text):
        return 'user_interrupt'
    if ROLE_BADGE.match(text):
        return 'cross_role'
    return 'human_vibe'

new_records = []
new_index_lines = []
session_files = sorted(proj_dir.glob('*.jsonl'))
for sf in session_files:
    session_id = sf.stem
    # Pre-compute: map user records to the preceding wake content
    # and the subsequent assistant tool_use (the first reaction).
    lines = sf.read_text().splitlines()
    # Build a sidecar list of records with type tracking for lookbehind.
    records = []
    for ln in lines:
        if not ln.strip():
            continue
        try:
            records.append(json.loads(ln))
        except Exception:
            pass

    last_wake_text = ''
    for i, r in enumerate(records):
        if r.get('type') != 'user':
            continue
        uuid = r.get('uuid', '')
        key = f'{session_id}:{uuid}'
        if key in seen:
            continue
        content = r.get('message', {}).get('content', '')
        text = extract_text(content)
        cat = classify(text)
        if cat in ('wake_stop', 'wake_t2', 'harness_update', 'wake_simple',
                   'pane_restart_bootstrap', 'init_bootstrap', 'context_continuation',
                   'observer_probe', 'user_interrupt'):
            last_wake_text = text.splitlines()[0] if text else ''
        if cat != 'human_vibe':
            # Mark all non-human records as seen so we don't re-scan.
            new_index_lines.append(key)
            continue

        # Find first assistant tool_use after this record (if any, within 10 records).
        first_tool = ''
        for j in range(i + 1, min(i + 11, len(records))):
            rr = records[j]
            if rr.get('type') == 'assistant':
                rc = rr.get('message', {}).get('content', [])
                if isinstance(rc, list):
                    for piece in rc:
                        if isinstance(piece, dict) and piece.get('type') == 'tool_use':
                            first_tool = f"{piece.get('name', '')}({json.dumps(piece.get('input', {}))[:200]})"
                            break
                if first_tool:
                    break
        ts = r.get('timestamp', datetime.utcnow().isoformat() + 'Z')
        new_records.append({
            'ts': ts,
            'role': role,
            'session_id': session_id,
            'uuid': uuid,
            'content': text,
            'preceding_wake': last_wake_text,
            'first_tool_after': first_tool,
        })
        new_index_lines.append(key)

for rec in new_records:
    # YYYYMMDD/HHMMSS-role-session-uuid[:8].json
    try:
        dt = datetime.fromisoformat(rec['ts'].replace('Z', '+00:00'))
    except Exception:
        dt = datetime.utcnow()
    day = dt.strftime('%Y%m%d')
    hms = dt.strftime('%H%M%S')
    out_dir = audit_base / day
    out_dir.mkdir(parents=True, exist_ok=True)
    uuid_short = (rec['uuid'] or '00000000')[:8]
    out_file = out_dir / f"{hms}-{role}-{rec['session_id'][:8]}-{uuid_short}.json"
    if out_file.exists():
        continue
    out_file.write_text(json.dumps(rec, ensure_ascii=False, indent=2))

# Append new index lines.
if new_index_lines:
    with index_file.open('a') as fh:
        for k in new_index_lines:
            fh.write(k + '\n')

print(f'audit: role={role} new-human-vibe-records={len(new_records)}')
PY
