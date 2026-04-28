<!--
PR description template — githarness. Keep all sections. Reviewer will
use this structure as the acceptance criteria checklist.
-->

Closes #<issue-number>

## User Intent

<Two to four sentences on what a user observes differently after this
PR lands. Not a technical summary — a user-perspective narrative.>

**How a user notices**: <concrete steps and what they see>

**E2E that proves it**: `<suite>::<test_name>`

<!-- If purely internal (perf / refactor), say so explicitly and cite
     an observable metric: "No user-visible change — latency at p50
     reduced by 50ms on /api/foo". -->

## Context

<Why this issue exists and what the user-visible symptom or engineering
constraint is. Copy the key lines from the issue so the reviewer does
not have to click away.>

## Summary

<File-level or module-level bullet list. Be specific about function
names, env var names, new configuration values. One bullet per
noteworthy file.>

## Feature flag

<If a behavior flag is introduced, name it and state the default. If no
flag (internal refactor), say so and justify. If flag defaults to off,
cite the flip PR number or mark "flip pending".>

## Flag activation plan

<Only if this PR introduces a feature flag defaulted off. State when
the flip PR will land — usually within one working day for dev, and
within the same sprint for production.>

## Deployment pipeline

- [x] ① Local compose build — `docker compose up -d --build` green
- [x] ② Local E2E — `./tests/e2e/run.sh --skip-compose` all suites PASS
      (path: <relative path to test-results>)
- [x] No hardcoded values — `rg` self-check output: <empty or
      justification>
- [x] IaC synth/diff validated — attach `cdk synth` / `terraform
      validate` result (or "no IaC change")
- [ ] ③ Target-env IaC diff — <evaluator fills>
- [ ] ④ Target-env deploy — <evaluator fills>
- [ ] ⑤ Target-env remote E2E — <evaluator fills>
- [ ] ⑥ (if applicable) Secondary env diff + deploy
- [ ] ⑦ (if applicable) Secondary env remote E2E
- [ ] ⑧ Evidence comment posted — <evaluator fills>

## Performance / behavior impact

<Concrete measurements if performance: before/after p50/p95, iteration
count. For non-performance, describe behavior differences. If none,
say so.>

## Self-check (governance)

- [ ] No database mutations outside migration SQL
- [ ] No manual infrastructure changes outside IaC
- [ ] No E2E that bypasses the real user path
- [ ] No edits to frozen modules listed in CLAUDE.md
- [ ] PR touches <= ~30 files (or justification if larger)
