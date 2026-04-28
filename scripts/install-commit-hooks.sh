#!/usr/bin/env bash
# install-commit-hooks — optionally install a git post-commit hook
# that immediately pushes newly created commits to origin, so the
# operator and other agents see each commit in near-real-time
# rather than waiting for the next 30 s watchdog poll.
#
# Pattern adapted from anthropics/riv2025-long-horizon-coding-agent-demo
# (under Apache-2.0) — their bedrock_entrypoint installs a similar
# post-commit hook so every commit becomes a GitHub push immediately.
# See docs/12-riv2025-deep-analysis.md §8 "cherry-pick #1".
#
# Behavior:
#   - Runs on `git commit` success.
#   - Pushes the current branch to `origin/<same-name>`.
#   - Skipped on `main` / the project's release branch
#     (HARNESS_RELEASE_BRANCH) so agents never auto-push to the
#     production ref.
#   - Skipped when HARNESS_POSTCOMMIT_AUTOPUSH=0.
#   - Skipped when push would fail silently (no upstream) — the
#     hook logs and continues, never aborts the commit.
#
# Usage:
#   bash scripts/install-commit-hooks.sh         # install on this worktree
#   bash scripts/install-commit-hooks.sh --all   # install on every sibling worktree

set -uo pipefail

MODE="${1:-current}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

hook_content='#!/usr/bin/env bash
# githarness post-commit — auto-push to origin/<branch> for visibility.
# Disable: HARNESS_POSTCOMMIT_AUTOPUSH=0
set -uo pipefail

if [[ "${HARNESS_POSTCOMMIT_AUTOPUSH:-1}" == "0" ]]; then
  exit 0
fi

branch=$(git symbolic-ref --short -q HEAD || true)
[[ -z "$branch" ]] && exit 0  # detached HEAD — skip

release_list="${HARNESS_RELEASE_BRANCH:-main}"
for rb in ${release_list//,/ }; do
  if [[ "$branch" == "$rb" ]]; then
    echo "[post-commit] on release branch '\''$branch'\'' — skipping auto-push" >&2
    exit 0
  fi
done

# Push in the background; on failure, log but do not break the
# commit (the operator can push manually).
(
  git push --quiet origin "$branch" 2>/tmp/githarness-postpush-$$.err \
    || echo "[post-commit] auto-push failed for $branch (see /tmp/githarness-postpush-$$.err)" >&2
) &
disown
exit 0
'

install_into() {
  local wt="$1"
  local git_dir
  if [[ -d "$wt/.git" ]]; then
    git_dir="$wt/.git"
  elif [[ -f "$wt/.git" ]]; then
    git_dir=$(cd "$wt" && git rev-parse --git-dir)
    # for worktrees, common hooks live in <common-git-dir>/hooks
    git_dir=$(cd "$wt" && git rev-parse --git-common-dir)
  else
    echo "[install-commit-hooks] $wt is not a git repo — skipping" >&2
    return
  fi
  local hook_path="$git_dir/hooks/post-commit"
  printf '%s' "$hook_content" > "$hook_path"
  chmod +x "$hook_path"
  echo "[install-commit-hooks] installed → $hook_path"
}

if [[ "$MODE" == "--all" ]]; then
  # Install into every worktree sharing this repo.
  cd "$REPO_ROOT"
  git worktree list --porcelain \
    | awk '/^worktree /{print $2}' \
    | while read -r wt; do
        install_into "$wt"
      done
else
  install_into "$REPO_ROOT"
fi
