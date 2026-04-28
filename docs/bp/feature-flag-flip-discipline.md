# BP — feature flag flip discipline

**Catalog ref**: docs/14-bp-catalog.md §12.
**Level**: mandatory.

## Why

Merging a feature behind an off-by-default flag is a **code drop**,
not a release. The target environment runs the same behavior as
before the merge. "Merged" and "effective" are different things.

A common failure: a team merges four consecutive latency
improvements as flags defaulted off. A full week of performance
reports shows zero improvement because nobody flipped the flags.
The code is correct. The delivery is not.

## Rule

Every PR that introduces a feature flag defaulting to off must:

1. Include a `## Flag activation plan` block in the PR body with
   either:
   - The flip PR number (`#47`), if the flip PR already exists and is
     in draft; or
   - `flip pending — same sprint`, meaning the generator will open
     the flip PR within the same sprint.
2. The **generator** opens the flip PR (same sprint), not the
   evaluator. Generator is the owner of the underlying change.
3. The flip PR is the **smallest possible PR** that changes the
   default from off to on for the target environment. No logic
   changes ride along.

## Evaluator enforcement

- On every wake, evaluator lists merged PRs in the current sprint
  with `## Flag activation plan` in their body and cross-checks
  that a flip PR exists or is merged.
- If more than 5 business days have passed without a flip PR:
  - Label the original PR's closing issue `flag-abandoned`.
  - Open a follow-up issue asking whether the feature should be
    enabled, reverted, or left canary-only.
  - cc the planner.
- `flag-abandoned` is visible in the planner's curation agenda.

## Why same-sprint rather than "eventually"

An unflipped flag is technical debt that grows. The codebase
diverges from runtime reality, tests exercise off-path behavior,
metrics measure a pre-change world. The shorter the flip window,
the lower the drift.

## Anti-patterns

- Opening a feature PR and the flip PR as a single PR (mixes two
  risk profiles — reject).
- Flipping the flag by editing runtime config outside of a PR (by
  definition a deploy drift — reject).
- Merging a flag-gated feature and saying "we'll decide to flip
  after we see the metrics" without a concrete date → the decision
  never happens → `flag-abandoned`.
