---
name: uat-user-acceptance
description: User Acceptance Test — the evaluator runs a Playwright-driven full user journey that mirrors the operator-persona's real use sequence, not individual-scenario pass/fail. Each UAT run follows one of the personas documented in the issue (e.g. "first-time visitor", "admin closing a deal", "regular user checking notifications"), executes the entire journey including waits for async work (LLM responses, webhook delivery, background jobs), captures a full-page screenshot + video trace at each step, and scores the journey holistically (completable / partially completable / blocked). Complements E2E spec-level testing which is step-level pass/fail; UAT is journey-level, the way a human would use the product.
origin: githarness (extends ECC `browser-qa` + `click-path-audit`)
---

# Skill — UAT (User Acceptance Test) as a merge gate

## Why UAT on top of Playwright specs

`e2e-testing` and `browser-qa` (ECC absorbed) give **spec-level**
pass/fail — each test checks one assertion. UAT is **journey-
level**: one run exercises an entire user persona's day
sequentially. Bugs that appear only when steps run in sequence
(stale cache, async race, state bleed across pages) are caught
here and nowhere else.

The hot-deal 2026-04-28 retrospective revealed that CI green +
individual specs green + no live stack was possible. UAT adds
a "can this persona complete their day?" question that cannot
be answered without the stack running.

## Personas as the UAT unit

For every pilot, the planner defines 3-5 **personas** during
Bootstrap:

```
Persona: first-time visitor
  Goal: browse hot deals, save one to bookmarks, subscribe to alerts.
  Journey: load landing → scroll feed → tap deal → expand
           comments → bookmark → settings → enable push → return
           to feed.
  Completable = can get to "enabled push" state with no
           blocker / error modal.

Persona: admin closing a promoted deal
  Goal: review a flagged deal, moderate, notify submitter.
  Journey: admin login → moderation queue → open flagged →
           review evidence → close as resolved → confirmation
           email sent.
  Completable = "confirmation email sent" step shows success.
```

Personas live in `tests/uat/personas/<slug>.md`. One file per
persona. The file is the AC source; each generator PR that
touches the persona's path updates the persona file if
behavior changes.

## UAT spec structure

```
tests/uat/
├── personas/
│   ├── first-time-visitor.md
│   └── admin-moderation.md
├── specs/
│   ├── first-time-visitor.uat.ts
│   └── admin-moderation.uat.ts
├── playwright.config.uat.ts    # separate config: longer timeouts, video on
├── results/
│   ├── YYYYMMDD-HHMMSS/
│   │   ├── first-time-visitor.mp4
│   │   ├── first-time-visitor.trace.zip
│   │   ├── first-time-visitor.summary.md    # per-step status
│   │   └── uat-run.summary.json
│   └── latest -> YYYYMMDD-HHMMSS
└── run.sh
```

A UAT spec is one `test()` per persona. Inside, one
`test.step(...)` per journey step, with a screenshot after
each step:

```typescript
test('first-time visitor completes their day', async ({ page }, testInfo) => {
  const steps: Record<string, string> = {};

  await test.step('Step 1 — load landing', async () => {
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('step-01-landing.png'),
      fullPage: true,
    });
    steps['landing'] = 'pass';
  });

  await test.step('Step 2 — scroll feed', async () => {
    await page.mouse.wheel(0, 3000);
    await expect(page.locator('[data-testid="deal-card"]')).toHaveCount({ min: 10 });
    await page.screenshot({ path: testInfo.outputPath('step-02-feed.png'), fullPage: true });
    steps['feed'] = 'pass';
  });

  // ... remaining journey steps ...

  await testInfo.attach('summary', { body: JSON.stringify(steps), contentType: 'application/json' });

  // Verdict: journey completable iff ALL steps pass.
  const failed = Object.entries(steps).filter(([_, s]) => s !== 'pass');
  expect(failed).toHaveLength(0);
});
```

## Running

```bash
docker compose up -d --build
./scripts/wait-for-healthy.sh
npx playwright test \
  --config tests/uat/playwright.config.uat.ts \
  --reporter=html,json \
  --output tests/uat/results/$(date -u +%Y%m%d-%H%M%S)
(cd tests/uat/results && ln -sfn "$(ls -1tr | tail -1)" latest)
```

Trace + video on every step (not just failures). UAT is
explicit about generating artifacts for the operator to watch
back — this is the "did it actually work" evidence layer.

## Config differences from standard E2E

```typescript
// tests/uat/playwright.config.uat.ts
export default defineConfig({
  testDir: './specs',
  timeout: 300_000,              // 5 min — personas can include LLM waits
  expect: { timeout: 10_000 },
  use: {
    video: 'on',                 // always on, not retain-on-failure
    trace: 'on',
    screenshot: 'only-on-failure' // test-level; step screenshots are explicit
  },
  retries: 0,                    // flaky UAT is an incident, not a retry
});
```

Retries are **zero** — UAT flakes mean the user-visible
behavior is flaky, which is a bug, not a retry target. If a
UAT is deterministic-flaky (seed data not reset, background
job timing), the fix is in the fixture, not the retry count.

## What UAT catches that specs don't

1. **State bleed across pages**. Spec A sets state X; spec B
   clears. Both pass. A real user hitting page A then page B
   hits the bleed.
2. **Async completion timing**. LLM call takes 12s in prod,
   mock returns in 200ms in tests. UAT waits for the real
   response.
3. **Copy / i18n bugs**. Specs check element presence; UAT
   screenshots show actual rendered text, and an operator
   eyeballing the MP4 catches "이 버튼 이름이 왜 이래?".
4. **Back-button / history regressions**. Hard to test with
   specs (playwright has `page.goBack()` but specs rarely use
   it); easy to observe in UAT replays.
5. **Mobile gesture paths**. Swipe, long-press, pull-to-refresh.
   Write the journey spec for mobile viewport; watch the video.

## Evaluator integration

Merge gate step 7 (in `scripts/eval-merge-gate.sh`):

```bash
# Gate 7: UAT latest run passed all personas
uat_latest=tests/uat/results/latest
if [[ ! -L "$uat_latest" ]]; then
  fail "no tests/uat/results/latest — UAT never ran"
fi
summary=$(cat "$uat_latest/uat-run.summary.json" 2>/dev/null)
passed=$(echo "$summary" | jq -r '[.. | .status? | select(. == "passed")] | length')
failed=$(echo "$summary" | jq -r '[.. | .status? | select(. == "failed")] | length')
if [[ "$failed" -gt 0 ]]; then
  fail "UAT reports $failed failed persona journey(s)"
fi
```

Evaluator attaches at least ONE UAT video + summary to the
merge comment (file-by-reference; commit the result dir).

## Relationship with persona file updates

If a PR changes persona behavior, the generator MUST:

1. Update `tests/uat/personas/<slug>.md` in the same PR.
2. Update `tests/uat/specs/<slug>.uat.ts` correspondingly.
3. Run the UAT locally; confirm the persona completes.

An evaluator seeing a PR that touches product paths without
updating personas flags it with a rework request: "behavior
changed, update the persona spec to match."

## When to skip

- Pure infra / CI / docs PRs: `HARNESS_GATE_SKIP_UAT=1`.
- Background-worker-only PRs with no user-visible surface:
  same.
- The evaluator justifies every skip in the merge comment.
  Un-justified skip = merge blocked.

## Relationship to other skills

- [`skills/for-evaluator/browser-qa.md`](browser-qa.md) —
  ECC absorbed: per-page health check. UAT is a *sequence*,
  browser-qa is a *page*. Both run.
- [`skills/for-evaluator/click-path-audit.md`](click-path-audit.md)
  — ECC absorbed: static analysis of handler chains for
  sequential-undo bugs. UAT is the runtime counterpart that
  observes the same class of bug via actual interaction.
- [`skills/for-evaluator/api-test-newman.md`](api-test-newman.md)
  — the protocol-level counterpart. UAT goes through the
  browser; Newman goes straight to HTTP. Together they
  cover both surfaces a user or client might actually hit.
- [`skills/for-evaluator/live-bdd-verification.md`](live-bdd-verification.md)
  — the root skill defining the "live stack + evidence"
  discipline; UAT and API test are the two concrete runners
  the live-BDD gate invokes.

## What UAT is NOT

- Not a replacement for unit or integration tests. The
  journey is expensive; the targeted assertion is cheap.
  Both.
- Not a replacement for individual Playwright specs. UAT
  passes when the journey completes; spec-level assertions
  let you say "the Save button on step 3 is red". UAT can't
  give you that granularity.
- Not a load test. One persona, one sequential run. Load
  testing is a separate discipline.
