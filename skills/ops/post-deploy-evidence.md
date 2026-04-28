---
name: post-deploy-evidence
origin: githarness (distilled from Heimdal)
---

Every `UPDATE_COMPLETE` is followed by the full E2E suite and
three artifacts. Not a subset. Rule:
`docs/bp/post-deploy-evidence.md`.

## Three artifacts

### 1. Per-suite pass/fail (inline in the PR comment)

```
| Suite                 | Pass | Fail | Notes            |
| sdk-compat            | 12   | 0    |                  |
| guardrails-parallel   | 8    | 0    |                  |
| budget-rate-limit     | 5    | 0    |                  |
| mcp-catalog           | 6    | 1    | known flake #89  |
| ──────────────────    | ──   | ──   |                  |
| TOTAL                 | 31   | 1    |                  |
```

### 2. Report path (full, copyable)

```
tests/e2e/test-results/dev/20260425/071500/<branch-slug>-<sha8>.html
```

Not "see latest". Not "in the usual place". The exact path.

### 3. Error/warning scan summary

```
$ grep -iE 'error|fail|❌' tests/e2e/test-results/dev/20260425/071500/*.log
  mcp-catalog.log:234: FAIL test_mcp_catalog_admin_list — known flake #89
```

If the scan finds something unexplained, triage before merging.

## Before-deploy baseline

The evaluator records the pre-deploy state for drift comparison:

```
ECS service running count: 4
Task definition rev: 72
Health check grace: 30s
```

After `UPDATE_COMPLETE`, the same numbers are captured and compared.
Changes outside the expected set → investigate.

## Failure path

Any suite fail → see `docs/bp/post-deploy-evidence.md` §"Failure
handling" and `CLAUDE.md.example` §"Failure triage".

## Anti-patterns

- "Deployed, tests passed locally, merging" — skipping remote E2E.
- Running only the suites you think the PR touched — regression
  paths are not predictable from the diff.
- Posting "tests passed ✅" with no table, no path, no scan.
