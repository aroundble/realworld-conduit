#!/usr/bin/env bash
# session-worktree-init — create sibling git worktrees per role.
#
# githarness runs one long-lived Claude Code session per role. If all
# sessions share one working tree, a checkout in one session reshapes
# everyone's files at once. The fix is a worktree per role.
#
# Layout (assuming the primary checkout is at ~/code/myproject):
#   ~/code/myproject/              ← operator's main checkout (this repo)
#   ~/code/myproject-planner/      ← planner session
#   ~/code/myproject-generator/    ← generator session
#   ~/code/myproject-evaluator/    ← evaluator session
#
# The sibling directories share .git/objects and remotes with the main
# checkout; only the working tree + HEAD are independent.
#
# Idempotent: existing worktrees are left alone (git fetch refreshed).
#
# Usage:
#   ./scripts/session-worktree-init.sh [base_branch]
#
# Env:
#   HARNESS_ROLES        space-separated roles (default "planner generator evaluator")
#   HARNESS_BASE_BRANCH  base branch for new worktrees (default: first of
#                        main, latest, master that exists on origin)
#
# Intentionally out of scope:
#   - Project-specific .env / docker-compose / port allocation. That
#     belongs to the project being harnessed, not the harness itself.
#     If your project needs per-worktree env, create a post-init hook
#     in your own repo.

set -euo pipefail

ROLES="${HARNESS_ROLES:-planner generator evaluator}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="$(cd "$ROOT/.." && pwd)"
REPO_BASENAME="$(basename "$ROOT")"

cd "$ROOT"
git fetch origin >/dev/null 2>&1 || true

# Pick the base branch: explicit arg > HARNESS_BASE_BRANCH > first of
# main/latest/master that exists on the remote.
BASE="${1:-${HARNESS_BASE_BRANCH:-}}"
if [[ -z "$BASE" ]]; then
  for cand in main latest master; do
    if git rev-parse --verify --quiet "origin/$cand" >/dev/null; then
      BASE="$cand"
      break
    fi
  done
fi
if [[ -z "$BASE" ]]; then
  echo "error: could not find main/latest/master on origin. pass base branch explicitly." >&2
  exit 2
fi

for role in $ROLES; do
  path="$PARENT/${REPO_BASENAME}-${role}"
  role_branch="role/${role}"
  if [[ -d "$path/.git" ]] || [[ -f "$path/.git" ]]; then
    echo "[$role] worktree already exists → $path"
    (cd "$path" && git fetch origin >/dev/null 2>&1 || true)
    continue
  fi
  if [[ -e "$path" ]]; then
    echo "[$role] path exists but is not a worktree: $path — remove or relocate it first" >&2
    continue
  fi
  echo "[$role] creating worktree → $path (branch ${role_branch} from origin/$BASE)"
  # Ensure the role anchor branch exists locally, rooted at the
  # integration branch. Worktrees cannot share a branch, so each
  # role gets its own anchor. Generator cuts feature branches
  # (feat/<slug>-<issue>, …) from here; evaluator uses `gh pr
  # checkout` during review.
  git branch -f "$role_branch" "origin/$BASE"
  git push -u origin "$role_branch" >/dev/null 2>&1 || true
  git worktree add "$path" "$role_branch"
done

echo
echo "done. canonical 4-pane tmux recipe (matches githarness init):"
session="harness-${REPO_BASENAME}"
echo "  tmux new-session -d -s $session -n harness -c $PARENT/${REPO_BASENAME}-planner"
idx=0
for role in $ROLES; do
  path="$PARENT/${REPO_BASENAME}-${role}"
  if [[ "$idx" -gt 0 ]]; then
    echo "  tmux split-window -t $session:harness.$((idx-1)) -c $path"
  fi
  echo "  # pane $idx = $role"
  idx=$((idx + 1))
done
echo
echo "  then in each pane:"
echo "  export HARNESS_SESSION_ROLE=<role> HARNESS_REPO=<owner/name>; claude --dangerously-skip-permissions"
echo
echo "current worktrees:"
git worktree list
