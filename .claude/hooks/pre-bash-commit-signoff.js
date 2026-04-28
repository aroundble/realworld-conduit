#!/usr/bin/env node
// PreToolUse hook — role Signed-off-by trailer on git commits.
//
// Every agent-authored commit must carry a "Signed-off-by:
// <role>@githarness" trailer in its body. This gives `git log`
// the same role attribution that the gh-badge hook gives to
// GitHub artifacts. All three roles share one git identity by
// design; the trailer is how operators tell them apart.
//
// Exit codes: 0 allow, 2 block.
// Env: HARNESS_SESSION_ROLE required for enforcement; unset = no-op.

'use strict';

const MAX_STDIN = 1024 * 1024;
const ROLE_RE = /Signed-off-by:\s*(planner|generator|evaluator)@githarness\b/;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (raw.length < MAX_STDIN) raw += c.substring(0, MAX_STDIN - raw.length);
});

process.stdin.on('end', () => {
  try {
    run(raw);
  } catch {
    // fail-open
  }
  process.stdout.write(raw);
  process.exit(0);
});

process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

function run(rawInput) {
  const role = process.env.HARNESS_SESSION_ROLE;
  if (!role) return;

  let input = {};
  try {
    input = rawInput ? JSON.parse(rawInput) : {};
  } catch {
    return;
  }
  if (input.tool_name !== 'Bash') return;

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!/\bgit\s+commit\b/.test(command)) return;
  if (/--amend\b/.test(command)) return;

  if (/\s-F\s|\s--file\b/.test(command)) {
    process.stderr.write(
      '[commit-signoff] warning: -F/--file used; cannot inspect message. ' +
        'Ensure the file contains "Signed-off-by: ' + role + '@githarness".\n',
    );
    return;
  }

  if (!/-m\b/.test(command) && !/--message\b/.test(command)) return;

  const messageBody = extractAllMessages(command);
  const m = messageBody.match(ROLE_RE);

  if (!m) {
    process.stderr.write(
      '[commit-signoff] BLOCKED — commit body must carry a role trailer.\n' +
        '  Expected line in message body: Signed-off-by: ' + role + '@githarness\n' +
        '  Example:\n' +
        '    git commit -m "feat(x): short subject" \\\n' +
        '               -m "body paragraph" \\\n' +
        '               -m "Signed-off-by: ' + role + '@githarness"\n' +
        '  (session env: HARNESS_SESSION_ROLE=' + role + ')\n',
    );
    process.exit(2);
  }

  const claimedRole = m[1];
  if (claimedRole !== role) {
    process.stderr.write(
      '[commit-signoff] BLOCKED — trailer says "' + claimedRole +
        '@githarness" but this session is ' + role + '. Only sign with your own role.\n',
    );
    process.exit(2);
  }
}

function extractAllMessages(command) {
  const re = /(?:-m|--message)(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\$'([^']*)'|([^\s]+))/g;
  const parts = [];
  let m;
  while ((m = re.exec(command)) !== null) {
    parts.push(m[1] || m[2] || m[3] || m[4] || '');
  }
  return parts.join('\n').replace(/\\n/g, '\n').replace(/\\"/g, '"');
}
