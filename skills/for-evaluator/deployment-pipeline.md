---
name: deployment-pipeline
description: Use when deploying a merged change to any non-local environment (dev, staging). Enforces the ordered sequence local full E2E → dev IaC diff → dev deploy → dev remote E2E → post-deploy evidence → merge. No skipping stages.
---

# Skill — Deployment pipeline

**For**: evaluator (primary), generator (awareness).
**Applies when**: the project deploys to any non-local environment.

## The principle

**Every change that touches runtime follows the same ordered
sequence from merge to a human-verified production (or
demo-to-users) environment. No shortcuts. No "just this once".**

The pipeline is defined by the project; the shape is universal:

```
local reproducible env → local full E2E →
  dev IaC diff → dev deploy → dev remote E2E →
    (if staging exists) staging diff → staging deploy → staging E2E →
      post-deploy full E2E + evidence → merge on pass →
        (if release) human-gated latest → main promotion →
          production deploy (human, not agent).
```

The generator stops at "local full E2E pass". Everything after is
the evaluator's authority. Production is human authority only.

## What this rules out

- **Deploying stacked PRs in a batch.** One PR, one deploy.
  Batching masks which PR caused which failure and slows triage
  when something breaks.
- **Skipping a pipeline stage** for a "small" change. The pipeline
  is the contract; an untouched stage is a bug in the test plan,
  not an optimization.
- **Post-deploy verification that is a subset of the E2E suite.**
  "Full" means the same suite the generator ran locally, but
  against the deployed environment. Skipping suites post-deploy
  is the most common way regressions slip to users.
- **Deploying to production or demo environments from an agent
  session.** Human only. The evaluator deploys to dev (and, when
  the project has staging, to staging). The promotion to
  production is a human-initiated PR.

## Per-stage requirements

Each stage in the pipeline produces a visible artifact:

- **Local full E2E** — report in the PR body.
- **Dev IaC diff** — copied into the PR's evidence section;
  "surprise" changes block the deploy.
- **Dev deploy** — the project's "healthy" signal verified
  (health check passes, rollout complete, no alarms).
- **Dev remote E2E** — comment on the PR with per-suite
  pass/fail + report path.
- **(Staging)** — same pattern as dev, one level higher.
- **Post-deploy evidence** — see
  `skills/ops/post-deploy-evidence.md` for the concrete form
  (3-artifact evidence block: environment-up / full E2E /
  portability).
- **Merge message** — per the evaluator's DoD step 10.

## Failure triage (cross-reference)

When remote E2E fails, the evaluator classifies per the
**failure-triage** discipline in `CLAUDE.md`:

1. **Reproduce locally** — pull the PR branch, run the same
   suite locally.
2. **Reproduces** → logic bug → back to generator with
   `CHANGES_REQUESTED` or `## 수정 요청`. Evaluator does not
   fix logic on the PR branch.
3. **Does not reproduce** → infra drift → evaluator fixes on the
   PR branch, re-deploys, re-verifies.
4. **Ambiguous after one honest attempt at both** → comment to
   operator.

## Related skills

- `skills/ops/post-deploy-evidence.md` — the concrete evidence
  format.
- `skills/for-evaluator/immutable-infrastructure.md` — what the deploy
  artifact references look like.
- `skills/ops/feature-flag-flip-discipline.md` — deploying behind a
  flag and flipping it on.
- `docs/14-bp-catalog.md §11` — this skill's enforcement level
  in the catalog.
