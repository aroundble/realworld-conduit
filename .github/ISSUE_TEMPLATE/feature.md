---
name: Feature
about: A new capability or a concrete user-visible improvement.
labels: type/feature
---

<!--
Filed by planner. Generator picks up via claim:generator.
-->

## User Intent

<!--
2-4 sentences in the user's voice. What does the user see change?
No technical detail.
-->

## Acceptance criteria

- [ ] <testable outcome 1>
- [ ] <testable outcome 2>
- [ ] <testable outcome 3>

## Environment-dependent values (portability checklist)

- URLs, ports: <list, or "none">
- Secrets / credentials: <list, or "none">
- Feature flags: <list with default, or "none">
- Timeouts / retry counts: <list, or "none">

All must be in `infra/config/<env>.yaml` or env vars before PR —
never hardcoded. See `docs/bp/env-config-matrix.md`.

## Scope

**In scope**: <one paragraph>
**Out of scope**: <one paragraph; link follow-up issues if any>

## Suggested branch

`feat/<slug>-<this-issue-number>`

<!--
Planner derives the slug from the title using
scripts/issue-to-slug.sh. Generator uses this verbatim.
-->

## Related

- Roadmap: <link or "ad-hoc">
- Depends on: #<N>, or "none"
- Blocks: #<N>, or "none"
