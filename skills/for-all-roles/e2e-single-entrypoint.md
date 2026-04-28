---
name: e2e-single-entrypoint
description: Use when running end-to-end tests or verifying a deploy. Forbids ad-hoc curl / jq verification scripts; requires the project-defined single entrypoint (tests/e2e/run-e2e.sh or equivalent) with E2E_ENV resolution.
---

# Skill — E2E single entrypoint

**For**: all roles. Most load-bearing for generator and
evaluator.
**Applies always** in any project with E2E tests.

## The principle

**Every E2E test run in the project goes through the same
canonical entrypoint, and that entrypoint lives in a fixed
location in the repo. New ad-hoc test scripts, one-off curl
invocations, and hand-assembled verification pipelines do not
accumulate — they are replaced by reusable entries in the
canonical tree.**

The entrypoint is one command. It accepts an environment
selector (`E2E_ENV=local|dev|staging|...`) and optionally a
filter. It resolves URLs, cookies, credentials, and artifact
paths from environment metadata the project defines — not from
hand-typed values.

## Why this matters

Projects that accumulate one-off verification scripts
(`test_something.sh`, `check_xyz.py`, `verify-mcp.sh`) end up
with five different ways to run roughly the same thing, each
with a slightly different understanding of which URL, which
auth, which account. The generator, the evaluator, the next
operator, and CI all diverge. Regressions pass one invocation
and fail another, and nobody knows which is authoritative.

A single entrypoint forces the question "what does it mean to
say the tests pass?" to have exactly one answer per environment.

## What the entrypoint provides

- **URL resolution** per environment (never hardcoded in test
  code; see `skills/for-generator/portable-environment-values.md`).
- **Auth handling** per environment — local hardcoded dev
  credentials are fine; remote uses the project's real IdP;
  managed / production modes use M2M or similar. See
  `skills/stacks/auth/auth-roles-local-vs-prod.md`.
- **Artifact output** in the project's canonical report layout
  (see `skills/ops/test-reports-layout.md`): timestamped per-env
  directories, `summary.json`, per-run HTML, `latest`
  symlink.
- **Suite composition** — a fixed list of official E2E suites
  the entrypoint always runs in order, so "the tests passed"
  is not interpretable.

## What this rules out

- **Ad-hoc test scripts** at repo root or in `scripts/`.
  `test_*.py`, `check_*.sh`, `verify_*.sh`, `try_*.js` —
  forbidden anywhere outside the canonical test tree.
- **`curl | jq` combinations** typed repeatedly to verify a
  behavior. The verification goes in the canonical test tree or
  it does not exist.
- **Hardcoded URLs** inside test code. `http://localhost:8080`
  in a test file is a portability-values skill violation
  *and* an e2e-entrypoint skill violation simultaneously.
- **Environment-branching `if` blocks** inside suite code.
  `if env == "prod": url = "..." elif "dev": ...` belongs in the
  entrypoint's resolver, not the suite.
- **Suite-specific environment setup** inside the suite.
  Cookie extraction, token fetch, compose up / kind-up — all
  belong in the entrypoint's pre-run phase.

## The project's contract

The project's `CLAUDE.md` (outside the managed block) names:

- The single entrypoint path (typically `tests/e2e/run-e2e.sh`,
  but any one canonical path is fine).
- The full suite list the entrypoint runs.
- Where reports land (see `skills/ops/test-reports-layout.md`).
- How to add a new suite (usually: add a file matching a glob;
  the entrypoint's suite list updates automatically).

## Related skills

- `skills/for-all-roles/canonical-test-location.md` — the companion
  discipline for where test files live.
- `skills/for-evaluator/post-deploy-verification-gate.md` — the gate that
  invokes this entrypoint.
- `skills/ops/test-reports-layout.md` — the output format.
- `skills/for-generator/portable-environment-values.md` — why URLs and
  env values do not live inside test code.
