---
name: canonical-test-location
description: Use before creating a new test file or a verification script. Forbids one-off test scripts at repo root, scripts/, per-service directories. All tests live under the canonical test tree; the _smoke_ prefix is the only short-lived exception.
---

# Skill — Canonical test location

**For**: all roles. Most binding on generator (creates tests)
and evaluator (approves them).
**Applies always**.

## The principle

**All test files live under the project's canonical test tree.
No test-shaped files accumulate at the repo root, in
`scripts/`, in `tools/`, or under each service directory ad
hoc. New verification needs are satisfied by adding a file to
the canonical tree or extending an existing file — never by
dropping a one-off somewhere else.**

## Why

Temporary verification files (`test_this_thing.sh`,
`verify_that.py`, `debug_issue_42.js`) accumulate quickly and
become permanent. Six months later:

- Nobody knows which are authoritative.
- The files drift out of sync with the canonical suite.
- Searches for "the tests" return 40 results across 7
  directories.
- New contributors copy the pattern they see and add one more
  next to the old ones.

A single canonical tree with clear rules collapses this into
one question: "where does this test belong?" The answer is
always "inside the canonical tree, under the right subfolder".

## What this rules out

- Test files at repo root: `test_something.py`, `check.sh`,
  `smoke_test.js`. Move to canonical tree.
- Test files in `scripts/`: `scripts/test_migration.sh`,
  `scripts/verify_deployment.py`. Move to canonical tree.
- Test files sprinkled per service:
  `services/billing/test_quick.py` when the project's canonical
  tree is `tests/`. Move (or delete).
- "Quick check" files written during debugging and committed
  because "we might need it". Delete or move to canonical tree.
- `*.ipynb` verification notebooks at repo root. If the
  verification is worth keeping, it is worth being in the
  canonical tree as a proper test.

## The canonical tree

Standard layout (projects may adapt, but the project's
`CLAUDE.md` states the chosen layout):

```
tests/
  unit/                # pure, no I/O
  integration/         # component boundaries, may touch DB
  e2e/                 # real-user path, full stack
    run-e2e.sh         # single entrypoint (see sibling skill)
    test_*.py          # individual suites, prefix-matched by runner
    fixtures/
    test-results/      # canonical report landing zone (gitignored)
  bench/               # performance benchmarks, optional
```

Projects that use a non-Python stack follow the language's
conventions (Go: `*_test.go` next to source is fine for unit,
but E2E still lives under `tests/e2e/`; Rust: `tests/` at
crate root; JS: `__tests__/` or `tests/`). The principle is
one canonical location per test *kind*, not one literal
directory name.

## One-off exception: `_smoke_` prefix

Genuinely one-off smoke checks that do not need to persist
(confirming a single env variable is reachable, reproducing a
one-shot report for an incident) can live under `tests/e2e/`
with a `_smoke_` filename prefix and a dated comment at the
top indicating when it can be deleted. The `_smoke_` prefix
excludes them from the suite runner's default set; they can be
invoked explicitly.

If the smoke check survives three invocations across different
sessions, it is not a smoke — promote it to a normal suite.

## Related skills

- `skills/for-all-roles/e2e-single-entrypoint.md` — the single
  invocation path.
- `skills/ops/test-reports-layout.md` — where results land.
- `skills/for-all-roles/human-readable-artifacts.md` — test names and
  bodies are artifacts too; write them to be read.
