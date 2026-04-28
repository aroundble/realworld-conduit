---
name: Refactor
about: Change structure without changing behavior.
labels: type/refactor
---

## What changes

<!--
Describe the structural change. No user-visible behavior change
(if there is, this is a feature or a bug, not a refactor).
-->

## Why now

<!-- What does the codebase get out of this? Why can't it wait? -->

## Acceptance

- [ ] Test suite passes at same coverage or better.
- [ ] No behavior change (diff of user-facing responses / UI = 0).
- [ ] `cdk diff` clean (no unintended infra change).
- [ ] Portability grep clean.

## Scope

**In scope**: <one paragraph>
**Out of scope**: <anything tempting to pull in but deferred>

## Suggested branch

`refactor/<slug>-<this-issue-number>`

## Related

- Follows: #<N> (if this is part of a larger cleanup)
- Blocks: #<N>
