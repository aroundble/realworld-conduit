---
name: bdd-acceptance-scenarios
description: Use when writing or reviewing acceptance criteria on any planner-filed issue, any generator PR, or any evaluator review. Defines the Given/When/Then scenario format all three roles share as the single contract between intent and verification. Planners write ACs as scenarios; generators implement the matching test; evaluators run the scenarios live against the stack and score merge-readiness against them. Replaces prose-only AC that can pass CI while still being user-broken.
---

# Skill — BDD acceptance scenarios (Given/When/Then)

**For**: all three roles.
**Load order**: read before authoring AC (planner), before coding
(generator), before reviewing (evaluator).

## Why this skill exists

Observation from the 2026-04-28 hot-deal run: 83 merged PRs, full CI
green, no live compose ever booted. Reviewers cited "tests pass" as
deploy evidence. Tests exercised code paths — not user-visible
behavior. The integration branch looked healthy and the product was
not usable.

The root cause was structural, not lazy: acceptance criteria were
prose. Prose is easy to satisfy with any test that touches the code
path. A sentence like "admin can register a guardrail" is green the
moment a unit test imports the module and calls the constructor.

Given/When/Then fixes this. A scenario names the **concrete
observable behavior** from the user's perspective. A test that
satisfies it has to drive a real browser / real HTTP client through
the real stack, because the assertions live at the boundary the user
touches.

## The format

Every AC is one or more scenarios in this shape:

```
Scenario: <short human title, imperative, present-tense>
  Given <the precondition — existing state of the system>
  When <the user action — one thing, on one surface>
  Then <the observable outcome — what the user sees or receives>
  And <additional outcomes, optional>
```

Example on an issue:

```markdown
## Acceptance Criteria

### Scenario: Admin registers a new guardrail and it takes effect immediately
  Given an admin is signed in with role=admin
  And no "profanity" guardrail exists for the tenant
  When the admin opens the Guardrails page and submits "profanity" with severity=block
  Then the new rule appears in the rules table within 2 seconds
  And a subsequent user request containing profanity is rejected with HTTP 403
  And the rejection reason field reads "profanity (severity=block)"

### Scenario: A rule with no severity set cannot be saved
  Given the admin is on the guardrails creation form
  When the admin submits with name="test" and severity blank
  Then the form shows "Severity is required" inline next to the field
  And no network call to /api/guardrails is made
```

Every clause is concrete. Every Then is something the evaluator can
point Playwright at and either see or not see.

## Who does what

### Planner — authors scenarios

When filing a `claim:generator` issue, write the AC as 1-3 scenarios.
Rules:

- **Each scenario is from the end-user's perspective.** "The admin
  sees X", "the API caller receives Y". Never "the service logs Z"
  or "the function returns W" — those are implementation details.
- **One scenario per user intent.** If an issue has two intents, it
  is two issues. Vibe-studio's 20-self-PR loop started from over-
  wide issues that could pass on any of five different scenarios.
- **Preconditions are states, not setup commands.** "Given the user
  has two pending orders" — not "Given the seed script has run".
  The generator picks the setup. The Given names the state.
- **One observable per Then.** "Then the order count badge shows
  2" is one assertion. "Then the UI updates and the DB is written
  and the webhook fires" is three — split it (And / And).
- **Concrete values.** Not "Then the response is correct" — "Then
  the response is HTTP 200 with `{status: 'approved'}`".

### Generator — implements to satisfy scenarios

When picking up an issue, the scenarios are the contract:

- **Read scenarios before writing code.** They are the spec; the
  surrounding prose is context.
- **Author one Playwright (or equivalent) spec per scenario.** File
  it under `tests/e2e/specs/` (or the project's convention per
  `skills/for-all-roles/e2e-single-entrypoint.md`). Name the test
  by the scenario title.
- **Exercise the real boundary.** The test drives a browser (for
  UI) or issues an HTTP request (for API-only). It does not import
  the module and call the function.
- **Run the spec against live compose before opening the PR.** The
  walking-skeleton is `docker compose up -d` → `pnpm test:e2e` →
  all scenarios green. Evidence in the PR body.
- **If a scenario is unimplementable as written**, escalate via
  `contract:disputed` (see `prompts/generator.md` §Contract
  escalation). Do not silently relax the Then.

### Evaluator — runs scenarios live

At review time:

- **Re-run every scenario against the PR branch's live stack**
  before grading. Not the generator's recorded evidence — your own
  run. See `skills/for-evaluator/live-bdd-verification.md` for the
  runtime gate.
- **Capture one screenshot per scenario** (see
  `skills/for-evaluator/visual-evidence.md`). Attach to the PR. The
  screenshot is the `Then` clause, photographed.
- **Grade Axis 5 ("Deploy working + live BDD evidence")** on the
  outcome: every scenario green + screenshot attached = full score;
  any red or missing evidence = 0.
- **Missing scenarios = swap back to `claim:planner`.** If the
  issue has prose AC only, the issue is unreviewable by this
  skill's contract. Ask planner to rewrite.

## Scenario-to-test mapping

```
planner.issue.scenarios    →    generator.tests/e2e/specs/<slug>.spec.ts
       (1 per scenario)                (1 per scenario)
                                                │
                                                ▼
                                    evaluator.run + 1 screenshot
                                                │
                                                ▼
                                       Axis 5 grade
```

Naming convention (keeps traceability grep-able):

```
tests/e2e/specs/<issue-N>-<short-slug>.spec.ts
screenshots/<issue-N>-<scenario-N>.png
```

Example: issue #47, scenario "Admin registers a new guardrail" →
`tests/e2e/specs/47-admin-registers-guardrail.spec.ts` and
`screenshots/47-scenario-1.png`. The evaluator's merge comment cites
both paths.

## What this does NOT replace

- **Unit tests.** Scenarios are the user-visible contract; unit
  tests are the developer's scaffolding. A PR ships both.
- **Integration tests.** Backend-to-backend flows that never touch
  a user surface still need their own coverage. Scenarios cover
  what the user sees; integration covers what the services say to
  each other.
- **USER_INTENT docstrings** in test suites (see
  `skills/ops/test-reports-layout.md`). USER_INTENT is the
  narrative prologue; scenarios are the formal AC. They coexist.

## Related

- [`skills/for-all-roles/playwright-user-simulation.md`](playwright-user-simulation.md)
  — the runner that executes scenarios.
- [`skills/for-evaluator/live-bdd-verification.md`](../for-evaluator/live-bdd-verification.md)
  — the evaluator's Axis 5 gate.
- [`skills/for-evaluator/visual-evidence.md`](../for-evaluator/visual-evidence.md)
  — screenshot protocol per scenario.
- [`skills/ops/test-reports-layout.md`](../ops/test-reports-layout.md)
  — USER_INTENT narrative + meta.json scaffolding.
