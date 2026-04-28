#!/usr/bin/env node
/**
 * PostToolUse Edit/Write hook: warn on environment-leak patterns.
 *
 * Implements the "portability check at the smallest enforceable
 * boundary" principle from
 * skills/for-generator/portable-environment-values.md — catch the
 * leak at edit time rather than at PR time.
 *
 * This is a WARNING hook (stderr only; never blocks). Agents rely
 * on the at-PR-time portability grep in the generator's DoD for
 * the blocking check. This hook is an earlier reminder.
 *
 * Patterns flagged by default:
 *   - localhost:<digit>               (URL ports likely env-dependent)
 *   - 127.0.0.1                       (hardcoded local loopback)
 *   - /home/<username>/               (developer-specific absolute path)
 *   - /Users/<username>/              (macOS developer-specific)
 *   - 12-digit AWS account ID literal
 *   - AWS region literals (us-east-1 etc.) in runtime code
 *
 * Exclusions: paths under test/spec/mock/scripts/.kiro/docs are
 * excluded because they commonly intentionally cite env-specific
 * values.
 *
 * Exit: always 0. Hook communicates via stderr only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_STDIN = 1024 * 1024;

const PATTERNS = [
  { rx: /\blocalhost:\d+\b/, msg: 'localhost:<port> — env-dependent URL should come from config' },
  { rx: /\b127\.0\.0\.1\b/, msg: '127.0.0.1 — hardcoded loopback should come from config' },
  { rx: /\/home\/[a-z][\w.-]*\//, msg: '/home/<username>/ absolute path' },
  { rx: /\/Users\/[A-Za-z][\w.-]*\//, msg: '/Users/<username>/ absolute path (macOS)' },
  { rx: /\b\d{12}\b/, msg: '12-digit literal — possible AWS account ID' },
  { rx: /\b(?:us|eu|ap|sa|ca|af|me)-(?:east|west|north|south|central|northeast|southeast|southwest|northwest)-\d\b/, msg: 'AWS region literal' },
];

// Skip paths where env-leak patterns are often intentional.
const EXCLUDE_PATH_RXS = [
  /(?:^|\/)tests?\//,
  /(?:^|\/)__tests__\//,
  /(?:^|\/)spec\//,
  /(?:^|\/)__mocks__\//,
  /(?:^|\/)scripts\//,
  /(?:^|\/)\.kiro\//,
  /(?:^|\/)docs?\//,
  /(?:^|\/)fixtures?\//,
  /(?:^|\/)\.github\//,
  /(?:^|\/)\.env(?:\.|$)/,
  /\.md$/,
  /\.ya?ml$/, // YAML config files are often env-specific by design
];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (raw.length < MAX_STDIN) {
    raw += chunk.substring(0, MAX_STDIN - raw.length);
  }
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const tool = input.tool_name;
    if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
      process.exit(0);
    }

    const filePath = String(input.tool_input?.file_path || '');
    if (!filePath) process.exit(0);

    // Skip excluded paths.
    if (EXCLUDE_PATH_RXS.some((rx) => rx.test(filePath))) {
      process.exit(0);
    }

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      process.exit(0); // file may not exist yet; skip
    }

    const hits = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { rx, msg } of PATTERNS) {
        if (rx.test(line)) {
          hits.push({ lineNo: i + 1, msg, excerpt: line.trim().slice(0, 120) });
        }
      }
    }

    if (hits.length > 0) {
      process.stderr.write(
        `[portability-check] ${filePath}\n`,
      );
      const max = Math.min(hits.length, 5); // avoid firehose
      for (let i = 0; i < max; i++) {
        const h = hits[i];
        process.stderr.write(`  line ${h.lineNo}: ${h.msg}\n    | ${h.excerpt}\n`);
      }
      if (hits.length > max) {
        process.stderr.write(
          `  (+${hits.length - max} more occurrences; run the project's portability check for full list)\n`,
        );
      }
      process.stderr.write(
        `[portability-check] Extract these into config/env before PR open. See skills/for-generator/portable-environment-values.md.\n`,
      );
    }
  } catch {
    // fail-open on parse errors
  }
  process.exit(0);
});
