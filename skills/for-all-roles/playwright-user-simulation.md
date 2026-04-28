---
name: playwright-user-simulation
description: Use when any role needs to verify a web app, PWA, mobile-responsive UI, or any browser-facing feature from the end-user's perspective. Load this skill whenever the project's product is a web/PWA/mobile-web app. The skill provides a standard Playwright harness for (a) evaluator — running acceptance tests against the real user path before merge, (b) generator — quick self-verification before opening a PR, (c) planner — reproducing user-reported issues from the operator's pane messages and turning them into reproducible issues. Projects whose product is not a web app should ignore this skill; it auto-loads only when a browser-facing product is detected (package.json mentions next/vite/react/vue/svelte, or the planner's vision mentions "web app", "PWA", "mobile web", "홈화면").
---

# Skill — Playwright user simulation

**For**: all roles, most load-bearing for evaluator.
**Applies when**: the project ships a browser-facing product.

## Why this skill exists

Our B2C / PWA / "chatbot makes an app" class of project succeeds
or fails on the **non-developer end-user experience**:

- Does the app load in a mobile browser?
- Can the user actually tap through the flow without a confusing
  dead-end?
- Does the PWA install flow add a working home-screen icon?
- Are error states handled gracefully (no bare stack traces, no
  silent failures)?

Unit tests and API-level E2E do not catch any of this. The only
check that matches the actual user contract is **driving a real
browser through the real flow**. Playwright is the industry-
standard way to do that reproducibly in CI and in local dev.

## The three use cases this skill covers

### 1. Evaluator — pre-merge acceptance

When the evaluator reviews a generator PR whose change touches
user-visible surface (UI, routing, auth, PWA manifest, service
worker, etc.), before merge:

- Deploy the PR branch to `dev` (per
  [`deployment-pipeline`](../for-evaluator/deployment-pipeline.md)).
- Run `tests/e2e/run-e2e.sh E2E_ENV=dev` — which should invoke
  `npx playwright test` (or equivalent) against the dev URL.
- For any new feature in the PR: add a Playwright spec that
  exercises the end-to-end user path. Do not merge a
  user-visible change that lacks a user-path spec.

### 2. Generator — pre-PR self-check

Before opening a PR:

- `tests/e2e/run-e2e.sh E2E_ENV=local` to confirm the happy
  path still passes locally.
- For new UI code: one spec per new user-visible interaction,
  committed with the change.
- Playwright runs *headless* in local dev by default; the
  generator has no need to open a browser window.

### 3. Planner — reproducing operator reports

The operator types feedback into the planner pane. Some of
those reports are UI/UX bugs: "the install button does nothing",
"Korean text is cut off on iPhone", "the chatbot's last reply
wrapped weird". Before filing issues from these reports:

- Write a Playwright spec that reproduces the report.
- Commit it under `tests/e2e/specs/reported/<slug>.spec.ts`
  (or the project's equivalent path) flagged `test.fixme` or
  `test.skip` with the issue number in the title.
- File a `claim:generator` issue citing the spec path as
  "reproduces in `<spec>`" — the generator removes the skip
  once the fix lands.

This discipline prevents the "I can't reproduce" dead-end
where a report sits in a stale issue for weeks.

## Project responsibilities (stack-specific)

The harness does not install Playwright. A project that opts
into this skill must:

1. Add Playwright as a dev dep (`pnpm add -D @playwright/test`
   or equivalent).
2. Create `playwright.config.ts` with the project's baseURL
   resolved from `E2E_ENV` (local / dev / stg / prd).
3. Ensure `tests/e2e/run-e2e.sh` (or the project's canonical
   entrypoint per
   [`e2e-single-entrypoint`](e2e-single-entrypoint.md)) invokes
   Playwright.
4. Wire the browser install step (`npx playwright install
   chromium`) into the project's first-time-setup script.
5. Include a basic "app loads" smoke spec so the harness has
   something to run before features exist.

For PWA-specific projects (homescreen install, service worker,
offline), also:

- Add a spec that simulates the install prompt flow
  (`page.evaluate(() => new Event("beforeinstallprompt"))` and
  follow-up assertions).
- Verify `manifest.json` is served and parseable.
- Verify the service worker registers (`navigator.serviceWorker.ready`).
- Add an offline spec: `page.context().setOffline(true)` and
  confirm the shell still renders.

## When NOT to use

- Projects that are pure backend / CLI / library — there is no
  user path to simulate. The normal E2E single-entrypoint
  pattern covers the API-level assertions.
- One-off debugging — use the normal developer workflow
  (manual browser, Playwright UI mode). This skill is about
  the durable spec library, not interactive exploration.

## Related

- [`e2e-single-entrypoint`](e2e-single-entrypoint.md) — the
  meta-rule that every E2E run uses one canonical command;
  Playwright lives under that command.
- [`for-evaluator/post-deploy-verification-gate`](../for-evaluator/post-deploy-verification-gate.md) —
  E2E (including Playwright) must pass before merge.
- [`for-generator/evidence-bearing-pr`](../for-generator/evidence-bearing-pr.md) —
  PR body includes the Playwright spec count + pass/fail
  summary as part of evidence.
