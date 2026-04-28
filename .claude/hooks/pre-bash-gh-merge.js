#!/usr/bin/env node
/**
 * PreToolUse Bash hook: block merges to main.
 *
 * Every `githarness` project reserves `main` (or the equivalent
 * release branch) for human-initiated promotion. Agent sessions
 * merge to the integration branch (`latest` or whatever the
 * project configured) only. This hook catches the common slips:
 *
 *   - `gh pr merge <N> ... --base main`
 *   - `git push origin <branch>:main`
 *   - `git push --force origin main`
 *   - `git merge <branch>` while on main
 *
 * The rule is baked into the two hard don'ts and the autonomous
 * action boundary (CLAUDE.md.managed). This hook is the
 * deterministic runtime guard.
 *
 * Exit codes:
 *   0 = allow
 *   2 = block
 *
 * Stdin: Claude Code hook event JSON.
 * Stderr: human-readable explanation on block.
 */

'use strict';

const MAX_STDIN = 1024 * 1024;

// The release branch is conventionally `main`. Projects that use a
// different name (e.g. `production`, `release`) can override via env.
const RELEASE_BRANCHES = (process.env.HARNESS_RELEASE_BRANCH || 'main')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function looksLikeReleaseBranchMerge(cmd) {
  // Normalise whitespace for simpler regex.
  const c = cmd.replace(/\s+/g, ' ').trim();

  for (const rb of RELEASE_BRANCHES) {
    const rbEsc = rb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. `gh pr merge ... --base main` (any order of flags).
    // Note: `--` is not a word character in JS regex, so `\b--`
    // never anchors. We match on the preceding whitespace instead.
    if (new RegExp(`\\bgh\\s+pr\\s+merge\\b.*(?:^|\\s)--base\\s+${rbEsc}(?:$|\\s)`).test(c)) {
      return { matched: true, pattern: `gh pr merge --base ${rb}` };
    }

    // 2. `git push origin <branch>:main` (push to main ref).
    if (new RegExp(`\\bgit\\s+push\\b.*[\\s:]${rbEsc}(?:$|\\s)`).test(c)) {
      return { matched: true, pattern: `git push ... ${rb}` };
    }

    // 3. `git push --force origin main` (more explicit variant).
    if ((/\bgit\s+push\b.*(?:^|\s)(?:-f|--force)(?:$|\s)/.test(c))
      && new RegExp(`(?:^|[\\s:])${rbEsc}(?:$|\\s)`).test(c)) {
      return { matched: true, pattern: `git push --force ... ${rb}` };
    }
  }
  return { matched: false };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    if (input.tool_name !== 'Bash') {
      process.exit(0);
    }
    const cmd = String(input.tool_input?.command || '');
    if (!cmd) process.exit(0);

    const r = looksLikeReleaseBranchMerge(cmd);
    if (!r.matched) process.exit(0);

    process.stderr.write(
      `[pre-bash-gh-merge] BLOCKED — agents cannot merge to ${RELEASE_BRANCHES.join(
        ' / ',
      )}.\n` +
        `Detected: ${r.pattern}\n` +
        `Command:  ${cmd}\n\n` +
        `The release branch is human-only. Merge to the integration branch (typically 'latest') instead, then open a human-initiated PR from the integration branch to the release branch.\n` +
        `If you are certain this is legitimate automation and want to override, set HARNESS_RELEASE_BRANCH to exclude this branch, or temporarily disable this hook in .claude/settings.json.\n`,
    );
    process.exit(2);
  } catch (e) {
    // On parse / unexpected errors, do not block. Hooks must be fail-open
    // for commands they cannot reason about.
    process.exit(0);
  }
});
