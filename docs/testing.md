# E2E testing — Playwright full suite (#35)

Companion to `docs/quality-gates.md` (size-limit + LHCI) and
`docs/quality-gates-axe.md` (axe-core dynamic a11y gate).

## Running the suite

| Command | What it runs |
|---|---|
| `pnpm test:e2e` | Full suite: desktop project (every spec) + mobile project (specs tagged `@mobile`). |
| `pnpm test:e2e:smoke` | Desktop-only fast path, kept for CI smoke step. |
| `pnpm test:e2e:mobile` | Mobile project in isolation. |

Prereqs: `pnpm compose:up` is running and migrations have been applied.
`PLAYWRIGHT_BASE_URL` defaults to `http://localhost:3100`; `API_URL`
defaults to `http://localhost:3101`. Override for remote envs.

## Projects

`tests/e2e/playwright.config.ts` declares two projects:

- **desktop** — default Chromium at desktop viewport. Runs every spec
  in `tests/e2e/specs/`. The suite was authored against this shape;
  the existing per-issue filenames (`04-api-auth-...`,
  `17-web-homepage-...`) map 1:1 to roadmap features.
- **mobile** — Chromium with Pixel 5 device emulation (`390×844`,
  touch, mobile UA). Uses Playwright's `grep: /@mobile/` so only
  specs tagged `@mobile` run here — prevents the 100+ desktop tests
  from running twice.

A spec opts into mobile by appending `@mobile` to the test title:

```ts
test("homepage reflows on mobile viewport @mobile", async ({ page }) => {
  await page.goto(`${WEB_URL}/`);
  // assert viewport-appropriate layout...
});
```

Phase 1 lands one `@mobile` assertion on spec 17 (homepage navbar +
single-column article list + 44px tap targets). Phase 2 per-feature
migrations widen coverage.

## Auth storage-state fixture

`tests/e2e/fixtures/authStorage.ts` exports a Playwright fixture that
replaces the inline `registerUser` + `primeSession` helpers used by
Phase 0 specs. Adapted from
`mutoe/vue3-realworld-example-app @ dd34ba90` (`playwright/fixtures/authStorage.ts`,
MIT) — Vue → Next/React port.

Shape:

- `authedUser` (**worker-scoped**): registers one unique user per
  Playwright worker via `POST /api/users`, returns
  `{ username, session }`. Every test in that worker shares the
  same user — parallel workers get distinct users so the unique
  constraint on `email`/`username` never fires.
- `authedContext` (**test-scoped**): yields a fresh
  `BrowserContext` pre-primed with the authed user's
  `conduit_session` (HttpOnly) + `conduit-user` (presentation)
  cookies. The test opens a page off this context.

### Adopting it in a new spec

```ts
import { expect } from "@playwright/test";
import { test as authedTest } from "../fixtures/authStorage";

authedTest("authed flow", async ({ authedContext, authedUser }) => {
  const page = await authedContext.newPage();
  try {
    await page.goto(`${WEB_URL}/settings`);
    await expect(
      page.getByRole("form", { name: "Settings" }).getByPlaceholder("Your Name"),
    ).toHaveValue(authedUser.username);
  } finally {
    await page.close();
  }
});
```

Why close the page explicitly: the fixture's context outlives the
test (it's closed in the fixture teardown), so pages opened on it
must close to release handles — otherwise the same
`BrowserContext` accumulates pages across sibling tests.

Why not `storageState` file on disk: the JWT carries an `iat` that
drifts past TTL across runs. Registering fresh per worker keeps
the token current.

### When to prefer inline cookie-priming

If your spec mutates the authenticated user's state in a way the
other tests in the same worker would notice (rotate password,
delete the user, change username), keep the inline
`registerUser` + `primeSession` pattern for that test — each
inline call gets its own user. The fixture is for read-heavy and
idempotent mutation flows.

Current Phase 1 adopter: spec 21 (`Scenario (via fixture): authed
user lands on settings with prefilled form`). The other 15 authed
specs keep their inline pattern; Phase 2 per-feature PRs migrate
each.

## Reports

Playwright writes a `summary.json` into
`tests/e2e/test-results/<utc-ts>/summary.json`. The evaluator's
merge gate (`scripts/eval-merge-gate.sh`) picks the freshest
summary by mtime. `PLAYWRIGHT_SUMMARY_PATH` overrides.

## Phase 2 follow-up — per-feature POP migration

Deferred from Phase 1 to keep each PR reviewable. One issue per
feature (auth, article, editor, home, profile, settings,
comments, favorite). Each issue:

1. Extracts a page object at `tests/e2e/page-objects/<feature>.ts`.
2. Refactors the matching spec(s) to use the POP.
3. Migrates the spec off inline cookie-priming onto `authedContext`
   where applicable.
4. Optionally renames `<nn>-<area>-<feature>.spec.ts` → `<feature>.spec.ts`
   if the CI artefact paths are migrated in the same PR.
