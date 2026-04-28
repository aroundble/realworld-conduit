#!/usr/bin/env node
// Adapted from everything-claude-code@098b773 under MIT license.
// Source: https://github.com/affaan-m/everything-claude-code/blob/main/scripts/hooks/config-protection.js
// Changes: attribution header added; logic otherwise verbatim.
/**
 * Config Protection Hook
 *
 * Blocks modifications to linter/formatter config files.
 * Agents frequently modify these to make checks pass instead of fixing
 * the actual code. This hook steers the agent back to fixing the source.
 *
 * Exit codes:
 *   0 = allow (not a config file)
 *   2 = block (config file modification attempted)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_STDIN = 1024 * 1024;
let raw = '';

const PROTECTED_FILES = new Set([
  // ESLint (legacy + v9 flat config, JS/TS/MJS/CJS)
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  // Prettier (all config variants including ESM)
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  // Biome
  'biome.json',
  'biome.jsonc',
  // Ruff (Python)
  '.ruff.toml',
  'ruff.toml',
  // Note: pyproject.toml is intentionally NOT included here because it
  // contains project metadata alongside linter config. Blocking all edits
  // to pyproject.toml would prevent legitimate dependency changes.
  // Shell / Style / Markdown
  '.shellcheckrc',
  '.stylelintrc',
  '.stylelintrc.json',
  '.stylelintrc.yml',
  '.markdownlint.json',
  '.markdownlint.yaml',
  '.markdownlintrc',
]);

function parseInput(inputOrRaw) {
  if (typeof inputOrRaw === 'string') {
    try {
      return inputOrRaw.trim() ? JSON.parse(inputOrRaw) : {};
    } catch {
      return {};
    }
  }

  return inputOrRaw && typeof inputOrRaw === 'object' ? inputOrRaw : {};
}

/**
 * Exportable run() for in-process execution via run-with-flags.js.
 * Avoids the ~50-100ms spawnSync overhead when available.
 */
function run(inputOrRaw, options = {}) {
  if (options.truncated) {
    return {
      exitCode: 2,
      stderr:
        `BLOCKED: Hook input exceeded ${options.maxStdin || MAX_STDIN} bytes. ` +
        'Refusing to bypass config-protection on a truncated payload. ' +
        'Retry with a smaller edit or disable the config-protection hook temporarily.'
    };
  }

  const input = parseInput(inputOrRaw);
  const filePath = input?.tool_input?.file_path || input?.tool_input?.file || '';
  if (!filePath) return { exitCode: 0 };

  const basename = path.basename(filePath);
  if (!PROTECTED_FILES.has(basename)) return { exitCode: 0 };

  // First-create is always allowed: a project initializing its linter /
  // formatter config for the first time is legitimate and must not be
  // blocked. The hook exists to stop agents from *weakening* an
  // existing config to make checks pass — not to prevent bootstrap.
  //
  // Resolve to absolute path against the project root (CLAUDE_PROJECT_DIR)
  // before existence check so relative paths don't false-pass on the
  // hook's own cwd.
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
  if (!fs.existsSync(absPath)) return { exitCode: 0 };

  return {
    exitCode: 2,
    stderr:
      `BLOCKED: Modifying existing ${basename} is not allowed. ` +
      'Fix the source code to satisfy linter/formatter rules instead of ' +
      'weakening the config. If this is a legitimate config change, ' +
      'disable the config-protection hook temporarily.',
  };
}

module.exports = { run };

// Stdin fallback for spawnSync execution
let truncated = /^(1|true|yes)$/i.test(String(process.env.ECC_HOOK_INPUT_TRUNCATED || ''));
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
    if (chunk.length > remaining) truncated = true;
  } else {
    truncated = true;
  }
});

process.stdin.on('end', () => {
  const result = run(raw, {
    truncated,
    maxStdin: Number(process.env.ECC_HOOK_INPUT_MAX_BYTES) || MAX_STDIN,
  });

  if (result.stderr) {
    process.stderr.write(result.stderr + '\n');
  }

  if (result.exitCode === 2) {
    process.exit(2);
  }

  process.stdout.write(raw);
});
