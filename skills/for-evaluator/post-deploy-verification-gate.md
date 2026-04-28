---
name: post-deploy-verification-gate
description: Use after any deploy that changes runtime state. Requires the four-step gate: runtime health check → full E2E → report → fix-and-re-run. The word 'deployed' never precedes the evidence.
---

# Skill — Post-deploy verification gate

**For**: generator (after local deploy), evaluator (after dev /
staging deploy).
**Applies when**: the project has any deploy step that changes
runtime state — whether that's `docker compose up -d --build`,
`kubectl apply`, a cloud IaC deploy, or a package publish.

## The principle

**After every deploy that changes runtime, the session must
verify the change before declaring the work complete. The
declaration of "deployed" never precedes the verification
evidence.**

A deploy without verification is not "done"; it is "maybe
done". A session that says "deployed ✓" without running the
project's verification suite is skipping the most load-bearing
quality gate the harness has.

## The four-step verification

Every post-deploy verification follows the same four-step
sequence. The exact commands are project-defined; the sequence
is universal.

1. **Runtime health check** — confirm every service reports
   healthy (HTTP 200 on `/health`, pod `Ready`, container
   `healthy`, container exit code 0, etc. depending on stack).
2. **Full E2E suite** — the project's canonical E2E entrypoint
   (see `skills/for-all-roles/e2e-single-entrypoint.md`), run against the
   environment that just deployed. Not a subset. Not the single
   suite matching the PR's area.
3. **Report produced** — the E2E run writes a structured report
   (per `skills/ops/test-reports-layout.md`). The path is quoted in
   the deploy evidence comment.
4. **Failures analysed, fixed, re-run** — any FAIL in the E2E
   report means the deploy is not done. Either fix the logic
   bug (back to generator via `## 수정 요청`) or fix the infra
   drift (evaluator patches the PR branch, redeploys). Loop
   until green.

**Before all four steps are green, do not write "deployed",
"complete", "done", "shipped" in any GitHub artifact.** This is
the verification gate.

## What this rules out

- **"Looks like it deployed"** based on the IaC tool's exit code
  alone. `cdk deploy` / `helm upgrade` / `terraform apply`
  returning 0 proves the command ran, not that the system
  works.
- **Partial suite runs** that skip suites the PR did not touch.
  Regression wins come from catching unrelated breakage; a
  verification that only exercises the PR's own area misses
  them.
- **Health checks against cached endpoints** that served prior
  state. The health check must hit the newly-deployed code path.
- **Silencing a failing suite** by marking it flaky within the
  same PR. Flakes open follow-up issues; they do not merge.

## The "not done" vocabulary

A session that has not completed all four verification steps
and still wants to report progress must use provisional
language:

- ✅ "Deploy command returned 0. Health check pending."
- ✅ "Stack reached UPDATE_COMPLETE. Running E2E now."
- ✅ "E2E in progress — 3/5 suites green, waiting on suite 4."

It may not say:

- ❌ "Deploy complete."
- ❌ "Done."
- ❌ "Shipped."

until the four steps are green.

## Escape hatch

Two legitimate exceptions:

1. **Pure doc / typo / comment-only changes** — no runtime
   change, no verification needed. The PR itself must declare
   "no runtime change" for evaluator to recognise the exception.
2. **Explicit operator instruction to skip** — the operator
   types "skip verification on this one" in the pane with a
   reason. Logged verbatim in the evidence comment.

Any other skip is a discipline failure.

## Related skills

- `skills/for-evaluator/deployment-pipeline.md` — the ordered sequence
  this gate sits inside.
- `skills/for-all-roles/e2e-single-entrypoint.md` — how E2E is invoked
  in step 2.
- `skills/ops/post-deploy-evidence.md` — the 3-artifact evidence
  block the evaluator posts after the gate passes.
