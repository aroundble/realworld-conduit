# BP — post-deploy evidence

**Catalog ref**: docs/14-bp-catalog.md §11 and §14.
**Level**: mandatory.

## Why

A `cdk deploy` finishing with `UPDATE_COMPLETE` is not the same as
"it works". ECS rolling may have pinned to a task definition that
fails health check. A config reference may be missing in Secrets
Manager. A DNS propagation step may be incomplete.

The only way to know is to exercise the real user path against the
real environment, and to archive the evidence so the next hand-off
can audit it without re-running.

## Rule

On every successful deploy (CFN `UPDATE_COMPLETE` to any target
env), the evaluator runs the **full** E2E suite and posts three
artifacts.

### 1. Per-suite pass/fail table

```
Suite          Passed     Failed   Notes
api            120/120    0
ui              45/45     0
integration     69/70     1        known flake: #89
TOTAL          234/235    1
```

### 2. Report path

A full URL or absolute path the next operator can open:

```
tests/e2e/test-results/dev/20260425/071500/<branch-slug>-<sha8>.html
```

### 3. Error/warning scan

```
grep -iE 'error|fail|❌' test-results/dev/20260425/071500/*.log
  → 1 hit: known flake in integration suite
```

All three live inline in the PR evidence comment. They are never
attachments that disappear behind a reaction.

## What counts as "full"

The entire suite, not just the files changed in the PR. Reason:
regression paths are not predictable from the diff. A change in
`ui/src/auth/` can break `tests/e2e/api/checkout.spec.ts`
through shared session cookies.

Selecting a subset is explicitly forbidden.

## Failure handling

If any suite fails:

- Do not merge.
- Reproduce locally (see `docs/bp/e2e-report-layout.md` for the
  local path).
- If reproduces → logic bug, `## 수정 요청` comment + label swap
  back to generator.
- If does not reproduce → environment drift, evaluator fixes IaC on
  the PR branch.

## Pre-merge checklist (evaluator, every time)

- [ ] `cdk diff` shows only intended changes.
- [ ] `cdk deploy` reached `UPDATE_COMPLETE`.
- [ ] ECS/Lambda rolling completed (all tasks running new revision).
- [ ] Full E2E passed, report generated.
- [ ] Three-artifact evidence posted to PR.
- [ ] If the PR introduced a flag defaulting off, the flip plan is
      noted.
