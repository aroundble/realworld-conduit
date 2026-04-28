<!--
  Adapted from everything-claude-code at SHA 098b773 under MIT license.
  Source: https://github.com/affaan-m/everything-claude-code/blob/main/rules/common/git-workflow.md
  Changes: attribution header added; content otherwise verbatim.
-->

---
name: ecc-git-workflow
description: Use when making a commit or opening a PR. Conventional commit format, branch naming, merge --delete-branch default. Ported from everything-claude-code.
---

# Git Workflow

## Commit Message Format
```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

> For the full development process (planning, TDD, code review) before git operations,
> see [development-workflow.md](./development-workflow.md).
