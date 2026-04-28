#!/usr/bin/env node
/**
 * Session audit log — captures every tool call into a durable,
 * grep-friendly newline-delimited JSON file under
 * `.githarness/audit/YYYY-MM-DD.jsonl`.
 *
 * Why this hook exists: `CRITIQUE.md §5` flagged that the
 * watchdog's state lives in `/tmp` and is neither committed nor
 * audit-trailed, which undermines the "every coordination
 * decision is visible in GitHub" claim. Tool invocations inside
 * a session were similarly invisible — only surfaced in the
 * session's own transcript, which does not survive context
 * reset. This hook writes a per-day audit log inside the repo
 * (gitignored by default; operator can choose to commit the
 * day's jsonl on demand) so the trail outlives the session.
 *
 * Event shape (one per line):
 *   {
 *     "ts": "ISO-8601",
 *     "role": "<HARNESS_SESSION_ROLE or 'nolocal'>",
 *     "pane": "<TMUX_PANE or 'nopane'>",
 *     "phase": "pre" | "post",
 *     "tool": "<tool_name>",
 *     "input_summary": "<short safe summary>",
 *     "output_summary": "<short safe summary; post only>"
 *   }
 *
 * Input summarization deliberately avoids logging full arguments.
 * We capture just enough to answer "what category of action
 * happened when" — not to replay the session.
 *
 * Env:
 *   HARNESS_AUDIT_DIR — override default .githarness/audit path.
 *   HARNESS_AUDIT_DISABLED=1 — disable the hook entirely.
 */

'use strict';

const fs = require('fs');
const path = require('path');

if (process.env.HARNESS_AUDIT_DISABLED === '1') {
  // Still drain stdin so Claude Code does not block.
  process.stdin.resume();
  process.stdin.on('data', () => {});
  process.stdin.on('end', () => process.exit(0));
  return;
}

const MAX_STDIN = 1024 * 1024;
const MAX_SUMMARY = 200;

function summarize(v) {
  if (v == null) return '';
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > MAX_SUMMARY) s = s.slice(0, MAX_SUMMARY - 3) + '...';
  return s;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (raw.length < MAX_STDIN) raw += chunk.substring(0, MAX_STDIN - raw.length);
});

process.stdin.on('end', () => {
  // Wrap EVERYTHING — filesystem, env lookup, JSON write — in a single
  // try. This hook runs on every tool call; a single uncaught error
  // leaks to stderr and spams the pane for the whole session.
  try {
    let input = {};
    try {
      input = raw ? JSON.parse(raw) : {};
    } catch {
      input = {};
    }
    const tool = (input && input.tool_name) || 'unknown';
    const phase =
      input && input.tool_output !== undefined ? 'post' : 'pre';

    const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const auditDir =
      process.env.HARNESS_AUDIT_DIR ||
      path.join(repoRoot, '.githarness', 'audit');

    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(auditDir, `${today}.jsonl`);

    fs.mkdirSync(auditDir, { recursive: true });

    const event = {
      ts: new Date().toISOString(),
      role: process.env.HARNESS_SESSION_ROLE || 'nolocal',
      pane: process.env.TMUX_PANE || 'nopane',
      phase,
      tool,
      input_summary: summarize(input && input.tool_input),
    };
    if (phase === 'post') {
      const out =
        (input && input.tool_output && input.tool_output.output) ??
        (input && input.tool_output);
      event.output_summary = summarize(out);
    }

    fs.appendFileSync(file, JSON.stringify(event) + '\n');
  } catch {
    // fail-open — audit never blocks, never spams stderr
  }
  process.exit(0);
});

// Also catch any uncaught error outside the end handler (e.g. if stdin
// never fires 'end'). Still fail-open.
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
