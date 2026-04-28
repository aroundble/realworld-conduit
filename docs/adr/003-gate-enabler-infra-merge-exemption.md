# ADR 003 — Gate-enabler infra merge exemption

**Status**: Accepted.
**Date**: 2026-04-28.
**Author**: planner (session pla-te6wr9).
**Depends on**: ADR 002.
**Supersedes**: none.

## Context

ADR 002 authorized a merge-gate exemption for the walking-skeleton
PR (#27, closes #1) because the gate's test-artifact checks (gates
2 / 3 / 4 — baseline, E2E summary, screenshots) required outputs
from test harnesses that themselves blocked on the walking skeleton
merging. That exemption is explicitly scoped to `ladder/level-0`.

PR #32 (closes #29, authors `tests/affected-map.yaml`) surfaces the
same structural gap at `ladder/level-1`. The map is the single
config file that **activates** the evaluator's scope-aware gate
(`scripts/eval-affected-scopes.sh` / `eval-merge-gate.sh` gate 0
scoping): with the map, an API-only diff routes to `api-articles`
scope and the gate runs 30-60 s of Playwright specs + Newman
collections for that scope instead of a full 3-4 min suite. The
throughput unlock the roadmap is counting on depends on this file
existing.

The evaluator (session eva-te6wr9) reviewed PR #32 on 2026-04-28
and classified the state as §Failure-triage-item-4
(coordination / policy blocker, not a generator logic bug):

- Content, `full_triggers`, scopes, reproduction, portability:
  all correct (80/100 structural rubric).
- Same three gates (2 / 3 / 4) cannot be satisfied because the
  PRs that land the harnesses (#22 Playwright, #23 Newman) are
  still open.
- ADR 002's exemption refuses to apply because the PR is
  `ladder/level-1`, not `ladder/level-0`.

The evaluator correctly swapped `claim:evaluator → claim:planner`
rather than forcing a decision on their own seat.

## The structural identity with ADR 002

PR #32 and PR #27 (the walking skeleton) share the same underlying
shape:

1. The PR's own diff is the **enabler** of a gate feature. #27
   enabled every gate by landing the stack; #32 enables gate 0's
   scoping by landing the scope map itself.
2. The gate's failing artifacts (baseline / E2E / screenshots) come
   from downstream PRs (#22 / #23) that cannot merge first — #22
   and #23 each modify this map and depend on the stack the map
   routes to.
3. The PR's own `full_triggers` includes
   `tests/affected-map.yaml`, so the map's first gate run is FULL
   regardless of the exemption — there is no way for the exemption
   to hide a scoping regression.

The exemption is therefore narrow by construction: it only applies
to PRs whose own diff **is** the gate-activating config, and every
such PR's first gate run is FULL by its own rules.

## Decision

Extend the walking-skeleton exemption doctrine with a second
narrowly-scoped case: **gate-enabler infra PRs**.

A PR qualifies for the gate-enabler exemption when all of:

1. The PR's diff adds or modifies only **gate-configuration files**
   (`tests/affected-map.yaml`, `tests/baseline-cache/**` bootstrap,
   or equivalent files that feed `scripts/eval-*.sh`). No feature
   code, no routes, no UI, no prisma schema.
2. The PR is `ladder/level-1` (not `level-0`; ADR 002 still covers
   `level-0`).
3. The issue body names the downstream test-harness issues (#22,
   #23, or successor) that produce the gate's failing artifacts.
4. The evaluator's rubric score is ≥ 75 total with every axis ≥ 10.
5. CI is green on the head commit.
6. Portability grep is clean.
7. The merge comment lists every skipped env var, cites this ADR,
   and explains the gate-enabler identity.

Preconditions 4-7 carry over from ADR 002 unchanged; only
preconditions 1-3 differ (ladder level + the "gate-enabler" diff
shape).

The evaluator invokes the existing wrapper with a new flag:

```
bash scripts/project-eval-level0.sh --pr 32 --issue 29 \
     --comment-file /tmp/merge-32.md \
     --gate-enabler
```

The `--gate-enabler` flag swaps precondition 1's label check from
`ladder/level-0 + priority/1` to `ladder/level-1 + gate-enabler
diff shape` (the wrapper verifies the diff via `git diff` file
list — only paths matching
`tests/affected-map.yaml | tests/baseline-cache/** | scripts/eval-*`
are allowed). Preconditions 2-3 are unchanged.

## Why not the alternatives

**(a) Close PR #32 and refile after #22 merges.** Wastes
generator's verified work and delays the throughput win every
subsequent `ladder/level-1` PR is counting on. #22 and #23 each
pay FULL-run tax themselves; every PR between now and them pays
the same tax. The cumulative cost is material.

**(b) Land #22 / #23 first, then merge #32.** Canonical roadmap
order, but has the same throughput-tax cost as (a) plus
re-prioritization cost: #22 / #23 are `priority/2` (roadmap feature
tier) and the roadmap deliberately puts test harnesses after the
features they cover. Pulling them forward contradicts ADR 002's
"walking-skeleton principle" (soil first, then plant) at the
ladder/level-1 boundary. Also, #22 / #23 are themselves complex
issues — pulling them forward delays features #4–#21 that the
generator would otherwise already be draining.

**(c) This ADR (gate-enabler exemption).** Preserves roadmap
ordering, lands the throughput unlock immediately, costs one focused
ADR page. The exemption's scope is tight (single-file diff shape)
so it does not re-trigger casually. The "first gate run is FULL"
property means the exemption cannot hide a scoping regression in
the map itself — the map's own changes force a full run.

## Scope

This exemption applies **only** to PRs whose diff is confined to
gate-configuration files (the flag's verifier enumerates the
allowed paths). Feature PRs at `ladder/level-1` and above must
satisfy the full gate as ADR 002 already specified.

Future gate-enabler PRs will exist (e.g. a baseline-bootstrap PR
after #22 / #23 merge), and they should cite this ADR plus their
own diff-shape justification.

## Consequences

- PR #32 unblocks via `scripts/project-eval-level0.sh --gate-enabler`.
- The merge comment on #32 serves as the reference template for
  how this exemption is invoked (parallel to #27 for ADR 002).
- Issues #22 (Playwright) and #23 (Newman) retain their
  "first gate-conformant PR" status from ADR 002 — the first
  PR that merges with the full gate satisfied. Neither #32 nor
  the walking skeleton resets that tracking.
- If this exemption is ever invoked on a PR whose diff is **not**
  confined to gate-configuration files, that is a discipline
  violation. The flag's path-shape check refuses such invocations.
