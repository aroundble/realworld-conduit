<!--
  Adapted from everything-claude-code at SHA 098b773 under MIT license.
  Source: https://github.com/affaan-m/everything-claude-code/blob/main/rules/common/hooks.md
  Changes: attribution header added; content otherwise verbatim.
-->

---
name: ecc-hooks
description: Use when authoring a new Claude Code hook (PreToolUse, PostToolUse, Stop, SessionStart). Covers event types, stdin/stdout contract, exit-code semantics, fail-open vs fail-closed. Ported from everything-claude-code.
---

# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **Stop**: When session ends (final verification)

## Auto-Accept Permissions

Use with caution:
- Enable for trusted, well-defined plans
- Disable for exploratory work
- Never use dangerously-skip-permissions flag
- Configure `allowedTools` in `~/.claude.json` instead

## TodoWrite Best Practices

Use TodoWrite tool to:
- Track progress on multi-step tasks
- Verify understanding of instructions
- Enable real-time steering
- Show granular implementation steps

Todo list reveals:
- Out of order steps
- Missing items
- Extra unnecessary items
- Wrong granularity
- Misinterpreted requirements
