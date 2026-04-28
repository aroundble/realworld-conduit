# ECC rules — common discipline

These ten rules are ported verbatim from
[everything-claude-code](https://github.com/affaan-m/everything-claude-code)
at commit `098b773` under the MIT license. They cover general
engineering discipline that applies across languages, stacks,
and role types — agents use when and how, code review
checklists, coding style fundamentals, git workflow, hook
authoring, patterns for parallel agent evaluation, performance
(including model-tier selection), security, testing coverage
targets.

Each file carries an attribution header pointing at its source.
Text below the header is the upstream content unchanged.

## Files

| File | What it covers |
|---|---|
| [agents.md](agents.md) | Which agents to invoke when; subagent launch etiquette. |
| [code-review.md](code-review.md) | Review triggers and the 5-rule checklist. |
| [coding-style.md](coding-style.md) | Immutability, no-mutation, small-function principles. |
| [development-workflow.md](development-workflow.md) | Research-first (search existing code before writing new). |
| [git-workflow.md](git-workflow.md) | Conventional commits, branch hygiene. |
| [hooks.md](hooks.md) | Hook types reference + authoring pattern. |
| [patterns.md](patterns.md) | Skeleton-project + parallel agent evaluation patterns. |
| [performance.md](performance.md) | Model-tier selection (Haiku / Sonnet / Opus) by task complexity. |
| [security.md](security.md) | Pre-commit security checklist. |
| [testing.md](testing.md) | 80% coverage target + three test types. |

## Why these live under `for-all-roles`

These rules apply to every session regardless of role. A
planner writing an issue body draws on `code-review.md`
expectations to set acceptance criteria; a generator writing
code draws on `coding-style.md` and `testing.md`; an evaluator
reviewing a PR draws on all of them. Placing them under
`for-all-roles/ecc-rules/` makes the auto-match loader route
them to any role's session.

## Relationship to other skills

- **Prompts** (`prompts/<role>.md`) describe role identity; they
  do not mandate these rules by name. Discovery lives in each
  rule's own description matching.
- **Core skills** (`for-generator/`, `for-evaluator/`, and
  `for-all-roles/` non-ECC files) are githarness-authored
  principles. The ECC rules complement them — there is no
  contradiction, but there is useful overlap (e.g. both ECC
  `performance.md` and our core skills encourage model-tier
  discipline).
- **Stack-specific skills** (`skills/stacks/<stack>/`) override
  or extend these where the stack demands specifics.

## Upstream tracking

When the upstream `everything-claude-code` updates a rule file,
the operator can re-ingest by pointing `repo-ingest` at the
current SHA and re-copying the updated rule with an updated
attribution header. The three-agent ingest workflow (see
`docs/10-external-ingest-workflow.md`) is the canonical path
for this.
