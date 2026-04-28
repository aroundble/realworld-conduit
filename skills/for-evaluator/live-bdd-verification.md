---
name: live-bdd-verification
description: Use when reviewing any PR that touches user-visible behavior. Defines the runtime gate for evaluator Axis 5 — what "live evidence" actually means. Score 0 on Axis 5 unless you have executed the scenarios from the issue's AC against a real running stack (docker compose ps healthy, Playwright run green, per-scenario screenshot attached). Replaces "CI passed" as proof of user behavior.
---

# Skill — Live BDD verification (evaluator's Axis 5 gate)

**For**: evaluator.
**Applies at**: PR review, before grading Axis 5 and before merging.

## What this skill prevents

The 2026-04-28 hot-deal run: planner filed 83 issues, generator
merged 83 PRs, every CI check green, test runs green, code review
thorough. The entire backlog drained. Then the operator asked "so
can I demo it?" — `docker compose ps` showed zero containers. The
product had never actually been brought up. Every review comment
said "CI green, tests pass, approved." Nothing was wrong with the
code in isolation; nothing was right with the system in aggregate.

CI passing is evidence that code paths execute. It is not evidence
that the **user-visible behavior** works. This skill is the
discipline that closes that gap.

## The gate

To score Axis 5 non-zero on any PR that touches user-visible
behavior, you must produce, in the merge comment (or in the rework
comment if you are rejecting):

1. `docker compose ps` output with every service `Up (healthy)`.
2. The full Playwright / BDD run against that running stack,
   exiting 0, for every scenario listed in the issue's AC.
3. One screenshot per scenario (see
   `skills/for-evaluator/visual-evidence.md`).
4. An explicit note that you, the evaluator, personally performed
   steps 1-3 — not relied on the generator's recorded evidence.

Anything less is Axis 5 = 0.

## The runtime procedure

On `claim:evaluator` pickup, after code review:

```bash
# 1. Fetch the PR branch into your worktree.
git fetch origin
git checkout "$(gh pr view "$PR" --json headRefName --jq .headRefName)"

# 2. Bring the stack up fresh. Do NOT reuse a previous run's state.
docker compose down -v    # volumes too — seed data must be fresh
docker compose up -d --build

# 3. Wait for healthy. The project's reproducible-local-environment
#    skill defines what "healthy" means; the default is "every
#    service in docker compose ps shows (healthy)".
./scripts/wait-for-healthy.sh   # project-specific, blocks on health

# 4. Capture the healthy-state snapshot into the review comment.
docker compose ps > /tmp/compose-ps-${PR}.txt

# 5. Run the BDD scenarios — one per AC scenario.
E2E_ENV=local ./tests/e2e/run-e2e.sh --pr "$PR"

# 6. Check exit code. Non-zero anywhere = Axis 5 = 0, swap label
#    back to claim:generator with the failing scenario in the
#    rework comment.

# 7. Attach screenshots. The Playwright run produces them; you copy
#    them into the PR via gh pr comment --body-file.
```

If any of steps 2-7 fails (compose won't come up, health check
times out, any scenario goes red, no screenshots emitted), **do
not merge**. Swap to `claim:generator` with a `## 수정 요청`
comment naming:

- which step failed,
- the output / screenshot of the failure,
- the specific scenario that broke (quoted from the issue's AC),
- which of the DoD in `prompts/generator.md` was not satisfied.

## What counts as "user-visible" for this gate

Apply this gate whenever the PR touches any of:

- UI (routes, components, styles, copy, auth redirects, forms).
- HTTP APIs the frontend or an external client calls.
- Background jobs whose outputs the user sees (emails,
  notifications, exported files, updated dashboards).
- Any flag whose activation changes what the user can do.
- Any migration that changes what existing user data looks like.

Apply it even if the PR is "just" a refactor, if the refactor
touches any of the above paths. The discipline is about the
observable boundary, not the intent of the change.

Exceptions — these are the only PRs where Axis 5 can skip the live
run and instead rely on the unit/integration suite:

- Pure documentation changes.
- Changes to `.github/`, `scripts/`, `.claude/`, `skills/` —
  harness / meta-repo layer, no user-visible product surface.
- Dependency bumps that CI exercises (lockfile-only, no code
  change). Even here, `docker compose up -d` + health probe is
  cheap insurance.

When in doubt: run it. Five minutes of compose-up is cheaper than
finding out at demo time that a flag defaulted off in the image.

## Mapping scenarios to evidence

Per issue, the AC has N scenarios. Per PR, the merge comment has N
screenshot attachments named `<issue>-scenario-<1..N>.png` and the
`run-e2e.sh` output shows N passing specs.

```
issue.scenarios[N]  ←  unchanged, that was the contract
     │
     ▼
pr.playwright.specs[N]   (generator authored, one per scenario)
     │
     ▼
evaluator.live.run → N green + N screenshots + compose ps healthy
     │
     ▼
merge comment Axis 5 = 20, cites scenario title + screenshot path
```

Fewer screenshots than scenarios = incomplete evidence = Axis 5 capped
at `20 × (screenshots / scenarios)`.

## The local-only deploy mode

If `HARNESS_DEPLOY_MODE=local-only`, this skill is the ENTIRE deploy
gate. There is no dev URL, no CDK deploy, no remote E2E — this is
the only evidence the integration branch ever sees. The skepticism
dial turns up accordingly:

- Run Playwright in **multiple devices** (`--project=chromium`,
  `--project=mobile-chrome`, `--project=webkit`) — not just desktop
  Chromium. The non-developer operator will open it on their
  phone.
- Run with a **slow-3G throttle** on at least one critical scenario
  (Playwright supports `page.route` + `context.setExtraHTTPHeaders`
  for this). Flags and lazy-loaded bundles frequently break on
  real-world networks.
- Run with **offline** toggled on on at least one scenario if the
  project claims PWA / offline behavior (see
  `skills/for-all-roles/playwright-user-simulation.md` for the
  setter).

In cloud mode, you also run the remote E2E against `dev`, but the
local run above still happens. Cloud E2E doesn't replace the
local-BDD gate; it's additional.

## Why this is an evaluator-only skill

The generator's DoD already requires local compose-up + their own
Playwright run before opening the PR (see
`prompts/generator.md` DoD). That evidence lives in the PR body.

This skill is what the **evaluator** does on top of that. Two
independent runs — generator's and evaluator's — catch both
"generator forgot to commit the spec" and "generator's local was
in a weird cached state".

The blog V2's line "agents tend to respond by confidently praising
the work" is why this skill can't trust the recorded evidence
alone. The evaluator re-runs because self-attestation is not the
same as independent confirmation.

## Related

- [`skills/for-all-roles/bdd-acceptance-scenarios.md`](../for-all-roles/bdd-acceptance-scenarios.md)
  — the AC format this skill verifies.
- [`skills/for-evaluator/visual-evidence.md`](visual-evidence.md) —
  the screenshot protocol that pairs with this skill.
- [`skills/for-evaluator/post-deploy-verification-gate.md`](post-deploy-verification-gate.md)
  — the cloud-deploy variant of the same discipline.
- [`prompts/evaluator.md`](../../prompts/evaluator.md) §Grading
  rubric Axis 5 — how this skill plugs into the merge gate.
