#!/usr/bin/env node
// Adapted from everything-claude-code@098b773 under MIT license.
// Source: https://github.com/affaan-m/everything-claude-code/blob/main/scripts/hooks/check-console-log.js
// Changes: inlined helpers (isGitRepo / getGitModifiedFiles / readFile / log)
// instead of importing scripts/lib/utils.js, since githarness does not carry
// the ECC shared lib. Exclusion list and warning text otherwise verbatim.

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

// ---- inlined helpers (originally in scripts/lib/utils.js) ----

function log(message) {
  console.error(message);
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function isGitRepo() {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function getGitModifiedFiles(patterns = []) {
  try {
    const r = spawnSync('git', ['diff', '--name-only', '--diff-filter=AM', 'HEAD'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (r.status !== 0) return [];
    const files = r.stdout.split('\n').filter(Boolean);
    if (patterns.length === 0) return files;
    const regexes = patterns
      .map((p) => {
        try {
          return new RegExp(p);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return files.filter((f) => regexes.some((rx) => rx.test(f)));
  } catch {
    return [];
  }
}

// ---- main hook (verbatim from ECC) ----

// Files where console.log is expected and should not trigger warnings
const EXCLUDED_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.config\.[jt]s$/,
  /scripts\//,
  /__tests__\//,
  /__mocks__\//,
];

const MAX_STDIN = 1024 * 1024;
let data = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  if (data.length < MAX_STDIN) {
    const remaining = MAX_STDIN - data.length;
    data += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  try {
    if (!isGitRepo()) {
      process.exit(0);
    }

    const modified = getGitModifiedFiles(['\\.[jt]sx?$']);
    const offenders = [];

    for (const f of modified) {
      if (EXCLUDED_PATTERNS.some((p) => p.test(f))) continue;
      const content = readFile(f);
      if (!content) continue;
      const hits = [];
      content.split('\n').forEach((line, i) => {
        if (/\bconsole\.log\b/.test(line)) {
          hits.push(i + 1);
        }
      });
      if (hits.length > 0) {
        offenders.push({ file: f, lines: hits });
      }
    }

    if (offenders.length > 0) {
      log('');
      log('[check-console-log] Found console.log statements in modified files:');
      for (const o of offenders) {
        log(`  ${o.file} (lines: ${o.lines.join(', ')})`);
      }
      log(
        '[check-console-log] If these are intentional (tests, scripts, config), ignore. Otherwise remove before committing.',
      );
      log('');
    }
  } catch {
    // Best-effort hook — never hard-fail.
  }
  process.exit(0);
});
