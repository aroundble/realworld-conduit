---
name: visual-evidence
description: Use when attaching screenshots to PR review/merge comments as BDD scenario evidence. Defines the filename convention, capture timing (at the Then clause), device matrix, and GitHub-attachment protocol. Pairs with live-bdd-verification — that skill tells you to capture screenshots; this skill tells you how, so a reviewer six months later can open the PR comment and see each scenario's user-visible outcome without re-running anything.
---

# Skill — Visual evidence (screenshot protocol)

**For**: evaluator primarily; generator also when authoring specs.
**Applies when**: any PR touches a user-visible surface.

## Why screenshots, not just test logs

Playwright logs say "test passed". A screenshot says "the Buy button
is visible, centered, reads 'Buy now', and sits above the footer".
They answer different questions. The test log proves the assertion
held; the screenshot proves the assertion was asserting the right
thing.

When a human operator opens the PR six weeks later asking "why did
we merge this?" — the screenshot is the answer. The log is a cold
trail.

## The one rule

**Every BDD scenario produces exactly one screenshot, captured at
the moment its `Then` clause becomes true.**

Not when the test starts. Not after teardown. At the assertion
moment — the frame that shows the user observing the outcome.

## Filename convention

```
tests/e2e/screenshots/<issue>/<scenario-slug>.<device>.png
```

Where:

- `<issue>` is the GitHub issue number (e.g. `47`).
- `<scenario-slug>` is a kebab-case-slug derived from the
  scenario title (e.g. `admin-registers-guardrail`).
- `<device>` is `desktop`, `mobile-chrome`, `webkit`, `offline`,
  `slow-3g`, or other Playwright project name.

Examples:

```
tests/e2e/screenshots/47/admin-registers-guardrail.desktop.png
tests/e2e/screenshots/47/admin-registers-guardrail.mobile-chrome.png
tests/e2e/screenshots/47/severity-required-validation.desktop.png
```

The pattern is grep-friendly. Six months from now, someone
investigating a regression on issue #47 can `ls
tests/e2e/screenshots/47/` and see the historical user-visible
state for every scenario that issue covers.

## Capture timing

In Playwright:

```typescript
test('Admin registers a new guardrail and it takes effect immediately', async ({ page }, testInfo) => {
  // Given
  await page.goto('/admin/guardrails');
  await expect(page.getByRole('heading', { name: 'Guardrails' })).toBeVisible();

  // When
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Name').fill('profanity');
  await page.getByLabel('Severity').selectOption('block');
  await page.getByRole('button', { name: 'Save' }).click();

  // Then — at THIS moment, the screenshot
  await expect(page.getByRole('row', { name: /profanity/ })).toBeVisible();
  await page.screenshot({
    path: `tests/e2e/screenshots/${ISSUE}/admin-registers-guardrail.${testInfo.project.name}.png`,
    fullPage: true,
  });

  // And — the HTTP 403 check
  const rejection = await page.request.post('/api/chat', {
    data: { message: 'some-profanity-here' },
  });
  expect(rejection.status()).toBe(403);
});
```

Rules:

- **Full-page screenshot** (`fullPage: true`) by default. Crops of
  small parts of the page lose context.
- **Before** the next user action. Once the test has moved on, the
  UI has moved on.
- **After** the assertion that marks the `Then`. Not
  before — a flash of intermediate state doesn't prove the outcome.
- One per scenario × one per device. Not "one per assertion in the
  scenario". A scenario with three `And` clauses still produces one
  final screenshot showing all three outcomes visible together.

## Attaching to the PR

GitHub's comment-with-images flow:

```bash
# 1. Upload the screenshots via gh. gh pr comment accepts the
#    --body-file path, and GitHub auto-renders markdown images
#    when paths are relative to the repo.
gh pr comment "$PR" --body-file /tmp/merge-evidence.md
```

`/tmp/merge-evidence.md` contents:

```markdown
## Live BDD evidence — PR #<N>

### Stack health
```
$(cat /tmp/compose-ps-${PR}.txt)
```

### Scenario evidence

#### Scenario 1: Admin registers a new guardrail and it takes effect immediately

![desktop](../blob/<branch-sha>/tests/e2e/screenshots/47/admin-registers-guardrail.desktop.png)
![mobile](../blob/<branch-sha>/tests/e2e/screenshots/47/admin-registers-guardrail.mobile-chrome.png)

Playwright log: `tests/e2e/test-results/local/<timestamp>/scenario-1.log`
Result: **PASS** on chromium, mobile-chrome, webkit.

#### Scenario 2: A rule with no severity set cannot be saved
...
```

For inline images, commit the screenshots to the PR branch (they
live at `tests/e2e/screenshots/<N>/`) so GitHub renders them from
the branch. Do not paste base64 or external URLs — the images must
survive the branch being deleted after merge (they're in the merge
commit's tree).

If the project wants to avoid committing binary artifacts: use a
separate GitHub Actions artifact upload, or a dedicated
`gh-pages`-style branch. Decide at project init; be consistent.
Default: commit them to the feature branch.

## Device matrix (local-only mode)

Per `skills/for-evaluator/live-bdd-verification.md`, local-only
mode runs the scenario on multiple devices. The screenshot set
mirrors that matrix:

| Device project | When to capture | Purpose |
|---|---|---|
| `desktop` (chromium 1920×1080) | always | the primary operator experience |
| `mobile-chrome` (Pixel 7) | always for B2C / PWA / mobile-web | the non-developer user's phone |
| `webkit` (Safari latest) | always for anything user-facing | Safari-only rendering bugs (iOS Safari ≠ Chrome) |
| `slow-3g` | any scenario that touches a new API call | reveals lazy-load / timeout regressions |
| `offline` | any PR touching service worker / caching | confirms offline shell still renders |

In cloud mode, the matrix is the same against the dev URL. The
screenshots go in both the local and the cloud-deploy merge-evidence
comment.

## When NOT to include screenshots

- Pure backend / CLI / library PRs with no user-visible output.
  The BDD skill says "use `curl` + response shape" for the Then;
  the evidence is the response body in a code block, not an image.
- Harness / meta-repo changes (the githarness repo itself,
  `.claude/*`, `prompts/*`, `scripts/session-*`). No user surface
  to photograph.
- Docs-only PRs. The change itself is the evidence.

## Screenshot hygiene

- **Dummy data only.** No real user PII, no real credentials, no
  real customer names. Seed data must be synthetic for every BDD
  run. If a screenshot leaks real data, delete the attachment and
  re-capture.
- **Consistent viewport per device.** 1920×1080 desktop,
  390×844 mobile-chrome (Pixel 7). Avoid "whatever my window was"
  sizing — comparability across PRs matters.
- **Redact nothing in evaluator captures.** Redaction is for
  human-posted screenshots; the harness runs against dummy data so
  there's nothing to redact. Redacted screenshots are a smell that
  the seed setup is wrong.

## Why this skill lives here

Without it: evaluators either (a) skip screenshots entirely and
rely on test logs — which means future-reviewers have no visual
audit, or (b) produce inconsistent one-off captures that get lost
or are uninterpretable across projects.

With it: every merged PR has the same shape of visual evidence,
every screenshot has a predictable path, and "what did this PR
actually change for a user?" is answerable in seconds from the PR
comment alone.

## Related

- [`skills/for-all-roles/bdd-acceptance-scenarios.md`](../for-all-roles/bdd-acceptance-scenarios.md)
  — the AC format that defines how many screenshots per PR.
- [`skills/for-evaluator/live-bdd-verification.md`](live-bdd-verification.md)
  — the runtime gate this skill supplies the visual layer for.
- [`skills/ops/test-reports-layout.md`](../ops/test-reports-layout.md)
  — the broader evidence directory the screenshots live alongside.
