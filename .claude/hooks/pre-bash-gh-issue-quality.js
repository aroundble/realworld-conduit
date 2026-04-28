#!/usr/bin/env node
// PreToolUse hook — quality gate on `gh issue create` / `gh issue edit`.
//
// Planner's past artifacts are the single biggest source of
// stuck-ness in this harness. LLMs write issue bodies with
// speculative blockers ("운영자 대기", "권한 없을 것이다") and
// mis-route work (claim:evaluator on code-authoring bodies).
// Both are invisible until the loop deadlocks.
//
// This hook catches them at issue-creation time and blocks the
// command. The planner must rewrite before filing.
//
// Three checks:
//   1. Speculative-blocker phrases in the body.
//   2. claim:evaluator label combined with body text that requires
//      authoring a file in the repo (CDK / Dockerfile / CI / tests
//      / feature code).
//   3. claim:evaluator label combined with body that describes a
//      standing-authority evaluator action (cdk deploy, cdk
//      bootstrap, gh pr merge, aws state-change) with no other
//      work — such issues should not exist; evaluator does these
//      without an issue.
//
// Exit codes:
//   0 — allow
//   2 — block (with explanation)

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_STDIN = 1024 * 1024;
const MAX_BODY_FILE_BYTES = 256 * 1024;

// Phrases that indicate the author is waiting on an out-of-loop
// signal. Match is case-insensitive and tolerates surrounding
// punctuation. Korean + English + a few common permission-wait
// idioms.
const SPECULATIVE_PATTERNS = [
  // Korean — operator required / waiting idioms. Tolerant of
  // particles (이/가/을/를) between noun and verb.
  /운영자[\s\S]{0,40}?(필요|기다려|대기|있어야|주시면|주면|줄\s*때|붙여주|등록해주|전달해주|확인해주)/,
  /사람[\s\S]{0,30}?(개입|승인|action|조치)/,
  /권한[\s\S]{0,30}?(없을|부족할|기다려)/,
  /운영자\s*수동/,
  /수동\s*(입력|조치|액션)/,
  // English — operator / human / user waiting idioms.
  /operator\s+(action|input|approval|to)\s+(required|provide|give|wait)/i,
  /wait(ing|s)?\s+(for|on)\s+(operator|human|user|approval|permission)/i,
  /pending\s+(operator|human|user|permission|approval)/i,
  /when\s+(the\s+)?operator\s+(provides|gives|approves)/i,
  /needs?\s+human\s+(approval|input|action)/i,
  /likely\s+(fails|will\s+fail)\s+(because|due)/i,
  /cannot\s+proceed\s+until/i,
  /blocked\s+on\s+(operator|human|user)/i,
  /manual\s+(approval|action|intervention)\s+required/i,
];

// Keywords indicating the body requires authoring files in the
// repo. If any of these appear together with `--label claim:evaluator`
// the issue is misrouted — should be claim:generator.
const CODE_AUTHORING_KEYWORDS = [
  /\bcdk\b.*\.ts\b/i,
  /\bnew\s+(Stack|cdk\.Stack)\b/,
  /\blib\/\w+-stack\.ts\b/i,
  /\bdockerfile\b/i,
  /\bdocker-compose\.ya?ml\b/i,
  /\.github\/workflows\b/,
  /\bplaywright\b.*\.spec\.ts\b/i,
  /\b(write|create|add|implement|scaffold)\s+(\w+\s+)?(lambda|handler|component|module|package|skill)\b/i,
  /\bpnpm\s+(install|add|create)\b/i,
  /\bnpx\s+create-\w+\b/i,
];

// Keywords indicating the body is only describing a standing-
// authority evaluator action. If the entire issue reduces to "do
// cdk deploy / bootstrap / merge", the issue should not exist.
const STANDING_ONLY_KEYWORDS = [
  /\bcdk\s+deploy\b/i,
  /\bcdk\s+bootstrap\b/i,
  /\baws\s+sts\s+assume-role\b/i,
  /\bgh\s+pr\s+merge\b/i,
];

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
  const isIssueCreate = /\bgh\s+issue\s+(create|edit)\b/.test(command);
  if (!isIssueCreate) return;

  const body = extractBody(command);
  if (body == null) {
    // --body-file or heredoc path could not be resolved — warn only.
    // (extractBody returns null when we could not read the file at all;
    // when we DO resolve the file we return its contents as a string.)
    process.stderr.write(
      '[issue-quality] warning: could not inspect body content ' +
        '(heredoc or unreadable --body-file path). Make sure the body has ' +
        'no speculative blockers ("운영자 대기" / "wait for operator") ' +
        'and that the claim: label matches the Role Routing Matrix.\n',
    );
    return;
  }

  // Check 1 — speculative blockers.
  for (const re of SPECULATIVE_PATTERNS) {
    const m = body.match(re);
    if (m) {
      blockWithMessage(
        'issue body contains a SPECULATIVE BLOCKER phrase: ' +
          `"${m[0]}".\n\n` +
          '  LLM-authored issues frequently include predictions like\n' +
          '  "operator must act first" or "권한이 없을 것이다" before any\n' +
          '  empirical evidence exists. Such issues deadlock the loop\n' +
          '  because the agent that receives the claim interprets the\n' +
          '  prediction as fact and never attempts the action.\n\n' +
          '  Rewrite: remove the speculation. Either\n' +
          '    (a) describe the work in imperative terms and let the\n' +
          '        claimed agent attempt it; record any real failure\n' +
          '        afterward, or\n' +
          '    (b) if the speculation is about a standing-authority\n' +
          '        evaluator action (cdk deploy / bootstrap / merge),\n' +
          '        do not file an issue at all — evaluator does these\n' +
          '        without an issue.',
      );
    }
  }

  // Check 2 — claim:evaluator on a body describing file-authoring work.
  const hasEvaluatorClaim = /--label\s+["']?claim:evaluator["']?/.test(command)
    || /\bclaim:evaluator\b/.test(body);
  if (hasEvaluatorClaim) {
    for (const re of CODE_AUTHORING_KEYWORDS) {
      if (re.test(body)) {
        blockWithMessage(
          'issue has claim:evaluator but body describes file-authoring ' +
            'work (matched: ' + re + ').\n\n' +
            '  The Role Routing Matrix (prompts/planner.md) is explicit:\n' +
            '  every new-code task (CDK, Dockerfile, CI yaml, tests,\n' +
            '  feature code) belongs to claim:generator. claim:evaluator\n' +
            '  is only for review/merge/deploy coordination.\n\n' +
            '  Fix: swap to --label claim:generator.',
        );
      }
    }
  }

  // Check 3 — claim:evaluator with only standing-authority action.
  if (hasEvaluatorClaim) {
    const mentionsStanding = STANDING_ONLY_KEYWORDS.some((re) => re.test(body));
    const mentionsOtherWork = CODE_AUTHORING_KEYWORDS.some((re) => re.test(body))
      || /\breview\b/i.test(body)
      || /\btriage\b/i.test(body);
    if (mentionsStanding && !mentionsOtherWork) {
      blockWithMessage(
        'issue reduces to a standing-authority evaluator action ' +
          '(cdk deploy / bootstrap / merge / sts assume-role).\n\n' +
          '  Evaluator performs these without an issue. Creating a\n' +
          '  claim:evaluator issue for them adds noise and invites a\n' +
          '  deadlock where the issue sits open after the action\n' +
          '  already succeeded.\n\n' +
          '  Fix: do not file this issue. Evaluator will pick up the\n' +
          '  action during its normal turn (triggered by the merge\n' +
          '  signal that should already be routing to it).',
      );
    }
  }
}

function extractBody(command) {
  // --body-file <path>  →  read the file and return its contents.
  // Planner previously wrote issues with `gh issue create --body-file
  // body.md`, which bypassed the speculative-blocker check. Resolve
  // the file and feed it into the same checks.
  const bodyFileMatch = command.match(
    /--body-file(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s]+))/,
  );
  if (bodyFileMatch) {
    const rawPath = (bodyFileMatch[1] || bodyFileMatch[2] || bodyFileMatch[3] || '')
      .trim();
    if (!rawPath) return null;
    const resolved = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return null;
      const fd = fs.openSync(resolved, 'r');
      try {
        const buf = Buffer.alloc(Math.min(stat.size, MAX_BODY_FILE_BYTES));
        fs.readSync(fd, buf, 0, buf.length, 0);
        return buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  }
  const apiBody = command.match(
    /(?:-F|-f|--field)\s+body=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s]*))/,
  );
  if (apiBody) return apiBody[1] || apiBody[2] || apiBody[3] || '';
  const bodyMatch = command.match(
    /--body(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\$'([^']*)'|([^\s]+))/,
  );
  if (bodyMatch) {
    return bodyMatch[1] || bodyMatch[2] || bodyMatch[3] || bodyMatch[4] || '';
  }
  if (/<<[-'"]?\s*(['"]?)([A-Z_]+)\1/.test(command)) return null;
  return null;
}

function blockWithMessage(reason) {
  process.stderr.write('[issue-quality] BLOCKED — ' + reason + '\n');
  process.exit(2);
}
