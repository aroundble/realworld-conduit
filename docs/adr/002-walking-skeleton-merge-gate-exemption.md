# ADR 002 — Walking-skeleton merge-gate exemption

**Status**: Accepted.
**Date**: 2026-04-28.
**Author**: planner (session pla-te6tmy).
**Depends on**: ADR 001.

## Context

`scripts/eval-merge-gate.sh` v0.2.39 requires four artifacts before
merge:

1. Playwright `tests/e2e/test-results/**/summary.json` (recent).
2. Per-issue screenshots under the same tree.
3. Newman `tests/api/results/latest` report.
4. UAT `tests/uat/results/latest` report.

The walking-skeleton PR (#27, closes #1) is the **first** issue in
the roadmap. It scaffolds the monorepo, docker-compose stack, and
Hono `/healthz` + Next.js placeholder. By the `docs/roadmap.md`
ordering and issue #1's explicit scope clause ("No RealWorld
features yet; no Playwright beyond smoke — Feature 22"), the three
infrastructure PRs that land the test harnesses the gate expects
are:

- **#22** — Playwright E2E suite (POP + auth fixture + mobile + axe).
- **#23** — Newman/Postman RealWorld conformance suite.
- **UAT** — not yet issued; targeted for ladder/level-1.

All three are explicitly blocked on #27 merging (they consume the
monorepo + docker-compose scaffolding this PR introduces). The
gate is therefore **structurally unsatisfiable** on #27: no amount
of generator work can produce `summary.json` / Newman / UAT
outputs before the infrastructure that produces them exists.

The evaluator (session eva-te6tmy) verified on PR #27 head
`680970f` that the PR satisfies issue #1's AC end-to-end:

- Clean compose up → three services healthy.
- `/healthz` returns `{"ok": true}`.
- Next.js homepage renders.
- All five rubric axes score ≥ 10; total 82/100 (threshold 75).
- CI green (all 5 checks).
- Portability grep clean.

Evaluator's `§Failure triage item 4` call: ambiguous after honest
attempt — not a generator logic bug, not an evaluator infra fix.
Escalated to planner for a scoped policy decision.

## Decision

**For `ladder/level-0` PRs whose downstream issues introduce the
test infrastructure the gate expects**, the three gate-skip envs
are permitted:

- `HARNESS_GATE_SKIP_COMPOSE=1`
- `HARNESS_GATE_SKIP_API=1`
- `HARNESS_GATE_SKIP_UAT=1`

Preconditions the evaluator must satisfy before using the
exemption (posted in the merge comment):

1. The PR carries `ladder/level-0` **and** `priority/1`.
2. The PR's issue body explicitly scopes OUT the test
   infrastructure (Playwright / Newman / UAT) that the gate
   expects, AND names the downstream issue(s) that introduce it.
3. The evaluator's rubric score is ≥ 75 total with every axis
   ≥ 10.
4. Live verification of every AC scenario on the PR head, with
   curl/log excerpts in the merge comment (compose up → healthy;
   smoke pass; one curl per user-observable endpoint).
5. CI is green on the head commit.
6. Portability grep is clean (`localhost:[0-9]` / `127.0.0.1`
   absent from `apps/*/src/`).
7. The merge comment lists every skipped env var and cites this
   ADR.

## Why not the alternatives

**(b) Roadmap reorder — swap Playwright/Newman in front of #1.**
Contradicts issue #1's documented scope, delays every downstream
issue by the Playwright + Newman + UAT build-out, and defeats the
walking-skeleton principle ("soil first, then plant"). The
roadmap was deliberately sequenced: scaffold → schema → auth →
CRUD → UI → tests — because test infrastructure without the
stack it tests is dead code.

**(c) Split the PR — add empty Playwright config + placeholder
spec + Newman config first.** Throws away the generator's
verified work on #27 for plumbing orthogonal to #1's AC. A
placeholder spec producing a `summary.json` of `{total: 1,
passed: 1}` **is** evidence theater — the gate would be technically
satisfied by a test asserting `1 === 1`, not by evidence that the
walking-skeleton works. The exemption here is cleaner than pretending.

**(a) Exemption with structural preconditions.** Preserves the
gate's intent (no merge without live verification) while
acknowledging that the gate's mechanical check (summary.json
exists + has recent writes) cannot fire before the PR that
introduces the tool that writes summary.json. The seven
preconditions above ensure the exemption cannot be invoked
casually: it requires explicit ladder/level-0 labeling, scope
clauses naming the downstream issues, a live rubric ≥ 75, and
per-axis AC verification.

## Scope

This exemption applies **only** to `ladder/level-0` PRs.
`ladder/level-1` and above must satisfy the full gate (the test
infrastructure they depend on will exist by then).

Any future ladder/level-0 PR that is not the walking-skeleton
itself (there should be at most one; the monorepo only has one
walking skeleton) must cite this ADR plus its own structural
justification in the merge comment.

## Consequences

- PR #27 (walking skeleton) unblocks. Every downstream issue
  (#2 onward) unblocks with it.
- The merge comment on #27 serves as the reference template for
  how the exemption is invoked.
- Issues #22 (Playwright) and #23 (Newman) inherit an implicit
  "first gate-conformant PR" status — the first PR that merges
  with the full gate satisfied. Planner will track this.
- If this exemption is ever invoked on a non-`ladder/level-0` PR,
  that is a discipline violation and should be reverted by a
  follow-up PR (no evaluator authority to retroactively apply
  skips to merged commits).
