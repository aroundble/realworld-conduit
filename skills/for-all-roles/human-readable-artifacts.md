---
name: human-readable-artifacts
description: Use when writing a commit message, PR body, issue, comment, ADR, or merge message. Forbids AI-generated trailers (Co-Authored-By: Claude, Generated with Claude Code, AI-assisted). Every artifact must pass the six-month test.
---

# Skill — Human-readable artifacts

**For**: all roles.
**Applies always**.

## The principle

**Every artifact the harness produces — commit, PR, issue,
comment, ADR, merge message — must read as if a human engineer
wrote it, six months from now, trying to understand why.**

The harness is allowed to be autonomous. It is not allowed to be
illegible. A repo whose commit log reads like
"feat: implement the feature (Closes #134)" repeated 500 times
is worse than a repo with 50 hand-crafted commits, because the
500-commit log cannot answer the questions a human inevitably
asks: why did this change happen, what was the alternative, who
approved the trade-off, which revision fixed the bug.

## What this rules out

- `Co-Authored-By: Claude <...>` trailers.
- "Generated with Claude Code" / "AI-assisted" / "Made by
  Anthropic's Claude" footers.
- Commit subjects that repeat the issue title verbatim.
- PR bodies that say only "Closes #N" without a User Intent,
  evidence, or reuse decision.
- Review comments that are single emojis or "LGTM" without
  specifics.
- ADRs that list options without naming the chosen one.

## What it requires

**Commits** (see `docs/06-commit-patterns.md` for the full
pattern):

- `<type>(<scope>): <subject>` in ≤ 72 chars.
- Body: first paragraph is *why* (the constraint or problem),
  not the solution. Bulleted list of concrete mechanisms
  follows. `Closes #N` on the final commit of a PR.

**PRs**:

- User Intent (copied from issue; updated if scope shifted).
- Upstream reuse block (cite ADR + upstream, or "scratch — ADR
  says X", or "n/a" for trivial work).
- Evidence block per the generator's DoD.
- Flag activation plan if a flag was introduced.

**Issues**:

- User Intent.
- Acceptance criteria.
- Reuse decision (from planner's OSS scout for non-trivial
  work; "n/a" for one-liners).
- Environment-dependent values checklist.
- Scope: in / out.

**Review comments**:

- Split `🔴 BLOCK` from `🟡 non-blocking`. A review that flags
  everything at the same level signals no judgment was applied.
- Each BLOCK has Situation / Problem / Fix.

**Merge messages**:

- Per the evaluator's DoD step 10: merge commit SHA, IaC diff
  summary, per-suite E2E results with report path, one-line
  confirmation of human-readable / portability / immutable /
  attribution.

**ADRs**:

- Named the chosen option + rationale.
- Named the rejected options + reason for each.
- Named the trade-off the decision accepts.

## The six-month test

Before any artifact is final, ask: "If a human engineer picks
this up six months from now with no context, will they
understand why this exists and what it does?" If no, the
artifact fails this skill.

The six-month test is the reason "AI-assisted" / "Generated
with" / `Co-Authored-By: Claude` footers are forbidden: they
tell the reader **nothing** about the change and actively
distract from the content. If the reader cares who wrote the
code, they can read `git blame`; they do not need a trailer.

## Related skills

- `docs/06-commit-patterns.md` — concrete commit/PR/review
  patterns from well-coordinated runs.
- `docs/15-behavioral-observations.md §2.3` — human-readable as
  an evaluator DoD lever.
