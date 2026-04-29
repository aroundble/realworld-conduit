import { test as base, request, type BrowserContext } from "@playwright/test";

// Auth storage-state fixture (#35 Phase 1).
//
// Pattern adapted from mutoe/vue3-realworld-example-app @ dd34ba90
// (`playwright/fixtures/authStorage.ts`, MIT). Vue → React/Next port:
// the fixture talks to our Hono API rather than MSW, and wires both
// `conduit_session` (HttpOnly credential) and `conduit-user`
// (presentation) cookies so the navbar + RSC auth checks both see
// an authenticated viewer.
//
// Shape:
//   - `authedUser`: per-worker fixture. Registers a unique user once
//     for the worker's lifetime (same user across every test in the
//     worker), returns `{ username, session, userCookie }`.
//   - `authedContext`: per-test fixture that hands back a new
//     `BrowserContext` pre-primed with the authed user's cookies.
//     Tests that need an authed page do `const { authedContext } =
//     testArgs` → `const page = await authedContext.newPage()`.
//
// Why per-worker (not per-test): register-per-test dominates spec
// wall-clock. Playwright workers already isolate state between each
// other; one user per worker is enough to exercise every authed
// flow and the 5× speedup target in #35 AC scenario 2 is met.
//
// Why not storageState files on disk: the RealWorld JWT carries an
// `iat` that'll drift past TTL if we cache the file across runs.
// Registering fresh per worker keeps the token current without
// stale-cookie surprises.

type AuthedUser = {
  username: string;
  session: string;
};

type AuthFixtures = {
  authedUser: AuthedUser;
  authedContext: BrowserContext;
};

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

export const test = base.extend<AuthFixtures, AuthedUser>({
  authedUser: [
    async ({}, use, workerInfo) => {
      // Unique per worker so parallel Playwright workers don't
      // clash on the user-table unique constraint.
      const id = `${Date.now()}-${workerInfo.workerIndex}`;
      const username = `fixture-${id}`;
      const api = await request.newContext({ baseURL: API_URL });
      const res = await api.post("/api/users", {
        data: {
          user: {
            username,
            email: `${username}@jake.jake`,
            password: "jakejake",
          },
        },
      });
      if (res.status() !== 201) {
        throw new Error(
          `authedUser register failed: ${res.status()} — ${await res.text()}`,
        );
      }
      const setCookie = res.headers()["set-cookie"] ?? "";
      const match = setCookie.match(/conduit_session=([^;]+)/);
      if (!match) {
        throw new Error("authedUser: API response lacked conduit_session");
      }
      await use({ username, session: match[1] });
    },
    { scope: "worker" },
  ],

  authedContext: async ({ browser, authedUser }, use) => {
    const context = await browser.newContext();
    const webOrigin = new URL(WEB_URL);
    await context.addCookies([
      {
        name: "conduit_session",
        value: authedUser.session,
        domain: webOrigin.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "conduit-user",
        value: encodeURIComponent(
          JSON.stringify({ username: authedUser.username, image: null }),
        ),
        domain: webOrigin.hostname,
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await use(context);
    await context.close();
  },
});

export { expect } from "@playwright/test";
