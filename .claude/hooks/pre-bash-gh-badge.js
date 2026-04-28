#!/usr/bin/env node
/**
 * PreToolUse hook — role badge enforcement on GitHub artifacts.
 *
 * Every comment / issue / PR body written by an agent must begin
 * with the role badge `[<role> @ <short-id>]` on its first non-empty
 * line. Without this, the operator cannot tell from the GitHub UI
 * which of the three agents authored any given artifact — the three
 * roles share one GitHub identity by design (single operator).
 *
 * Covered gh subcommands (matchers on `gh ...`):
 *   issue create         --body / --body-file
 *   issue comment        --body / --body-file
 *   issue edit           --body / --body-file
 *   pr create            --body / --body-file
 *   pr comment           --body / --body-file
 *   pr edit              --body / --body-file
 *   pr review            --body / --body-file (approve / request-changes / comment)
 *   api ...              POST / PATCH with --field body=... / -f body=...
 *
 * Skipped: --body-file is allowed through (we cannot inspect the
 * file content from the hook stdin payload without reading disk;
 * the hook warns instead of blocks in that case).
 *
 * Exit codes:
 *   0 — allow
 *   2 — block (badge missing)
 *
 * Env read:
 *   HARNESS_SESSION_ROLE — the role this session owns (required for
 *                         enforcement; if unset the hook is a no-op).
 *   HARNESS_SESSION_SHORT_ID — optional short-id to include after
 *                              the role. If unset, the hook derives
 *                              one from the pane + start time.
 */

'use strict';

const MAX_STDIN = 1024 * 1024;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (raw.length < MAX_STDIN) raw += c.substring(0, MAX_STDIN - raw.length);
});

process.stdin.on('end', () => {
  try {
    run(raw);
  } catch {
    // fail-open on any unexpected parse error
  }
  process.exit(0);
});

process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

function run(rawInput) {
  const role = process.env.HARNESS_SESSION_ROLE;
  if (!role) return; // no role = ad-hoc session, no enforcement

  let input = {};
  try {
    input = rawInput ? JSON.parse(rawInput) : {};
  } catch {
    return;
  }
  if (input.tool_name !== 'Bash') return;

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!/\bgh\b/.test(command)) return;

  // Check if this is a command we care about.
  const isGhIssueOrPr =
    /\bgh\s+(issue|pr)\s+(create|comment|edit|review)\b/.test(command);
  const isGhApiWithBody =
    /\bgh\s+api\b/.test(command) &&
    /-X\s*(POST|PATCH)|--method\s+(POST|PATCH)/.test(command) &&
    /(-F|--field|-f)\s+body[=\s]/.test(command);
  if (!isGhIssueOrPr && !isGhApiWithBody) return;

  const body = extractBody(command);
  if (body == null) {
    // --body-file or a form we cannot inspect. Warn to stderr but
    // allow through (LLMs routinely use --body-file for long bodies).
    process.stderr.write(
      '[gh-badge] warning: could not inspect --body content (likely --body-file); ' +
        'ensure the file starts with the role badge line.\n',
    );
    return;
  }

  const firstLine = body.trimStart().split('\n')[0].trim();
  const badgeRe = /^\[(planner|generator|evaluator)(\s+@\s+[A-Za-z0-9_.-]+)?\]/;
  if (badgeRe.test(firstLine)) {
    // Badge is present. Verify role matches this session.
    const m = firstLine.match(/^\[([a-z]+)/);
    const claimedRole = m && m[1];
    if (claimedRole && claimedRole !== role) {
      process.stderr.write(
        `[gh-badge] BLOCKED — badge says [${claimedRole}] but this session is ${role}. ` +
          `Only use your own role's badge.\n`,
      );
      process.exit(2);
    }
    return;
  }

  const shortId =
    process.env.HARNESS_SESSION_SHORT_ID ||
    deriveShortId(process.env.TMUX_PANE || '', role);
  process.stderr.write(
    `[gh-badge] BLOCKED — GitHub ${firstKind(command)} body must start with the role badge.\n` +
      `  Expected first line: [${role} @ ${shortId}]\n` +
      '  Example:\n' +
      `    [${role} @ ${shortId}]\n` +
      '    \n' +
      '    ## Summary\n' +
      '    ...\n' +
      `  (session env: HARNESS_SESSION_ROLE=${role}, HARNESS_SESSION_SHORT_ID=${shortId})\n`,
  );
  process.exit(2);
}

function firstKind(command) {
  if (/\bgh\s+issue\s+create\b/.test(command)) return 'issue';
  if (/\bgh\s+issue\s+comment\b/.test(command)) return 'issue comment';
  if (/\bgh\s+issue\s+edit\b/.test(command)) return 'issue edit';
  if (/\bgh\s+pr\s+create\b/.test(command)) return 'PR';
  if (/\bgh\s+pr\s+comment\b/.test(command)) return 'PR comment';
  if (/\bgh\s+pr\s+edit\b/.test(command)) return 'PR edit';
  if (/\bgh\s+pr\s+review\b/.test(command)) return 'PR review';
  if (/\bgh\s+api\b/.test(command)) return 'API body';
  return 'body';
}

// Extract the --body value from the command.
// Supports: --body "..." / --body '...' / --body=value / --body $'...'
// Also supports `--field body=...` and `-F body=...` / `-f body=...`.
// Returns null if --body-file was used (we cannot read files here) or
// if parsing fails.
function extractBody(command) {
  if (/--body-file\b/.test(command)) return null;

  // Strategy: find "--body" (or body= for gh api) + attempt to grab the
  // next quoted argument. We unescape a small set of shell quotes.

  // gh api --field body=... / -F body=... / -f body=...
  const apiBody = command.match(
    /(?:-F|-f|--field)\s+body=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s]*))/,
  );
  if (apiBody) {
    return apiBody[1] || apiBody[2] || apiBody[3] || '';
  }

  // gh issue/pr ... --body "..."
  const bodyMatch = command.match(
    /--body(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\$'([^']*)'|([^\s]+))/,
  );
  if (bodyMatch) {
    return bodyMatch[1] || bodyMatch[2] || bodyMatch[3] || bodyMatch[4] || '';
  }

  // Heredoc pattern — cannot reliably parse; warn via returning null.
  if (/<<[-'"]?\s*(['"]?)([A-Z_]+)\1/.test(command)) {
    return null;
  }

  return null;
}

function deriveShortId(pane, role) {
  const p = pane.replace(/[^A-Za-z0-9]/g, '') || 'nopane';
  const ts = Math.floor(Date.now() / 1000).toString(36);
  return `${role.slice(0, 3)}-${p}-${ts}`;
}
