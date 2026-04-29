import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";
import { runAxe } from "../axe-config";
import { SettingsPage } from "../page-objects/settings";
import { test as authedTest } from "../fixtures/authStorage";

// BDD coverage for issue #21: settings page (#21).
// Six scenarios matching the AC block.
//
// Every DOM selector lives in SettingsPage
// (tests/e2e/page-objects/settings.ts). #102 Phase 2 refactor.
//
// Fixture migration: Scenarios 2 + axe gate use the shared
// `authedContext` fixture from #35 Phase 1. Scenarios 3, 4, 5 keep
// inline priming because they mutate the authed user's state
// (duplicate-email seeds a second user, password rotation
// invalidates the existing cookie, logout clears cookies) — sharing
// a worker-scoped user across those would bleed state between
// sibling tests. Scenario 1 reads only, fixture-eligible, but we
// already have a fixture-driven proof-of-shape test below; keeping
// Scenario 1 inline keeps the "fresh user, empty form" assertion
// honest (fixture user's DB row is never fresh after the first
// test runs against it).

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type ApiCtx = Awaited<ReturnType<typeof request.newContext>>;
const apiContext = () => request.newContext({ baseURL: API_URL });

const registerUser = async (api: ApiCtx, username: string): Promise<string> => {
  const res = await api.post("/api/users", {
    data: {
      user: {
        username,
        email: `${username}@jake.jake`,
        password: "jakejake",
      },
    },
  });
  expect(res.status()).toBe(201);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/conduit_session=([^;]+)/);
  if (!match) throw new Error("expected conduit_session cookie from register");
  return match[1];
};

const primeSession = async (
  context: BrowserContext,
  session: string,
  username: string,
): Promise<void> => {
  const webOrigin = new URL(WEB_URL);
  await context.addCookies([
    {
      name: "conduit_session",
      value: session,
      domain: webOrigin.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "conduit-user",
      value: encodeURIComponent(JSON.stringify({ username, image: null })),
      domain: webOrigin.hostname,
      path: "/",
      sameSite: "Lax",
    },
  ]);
};

test.describe("issue #21 — settings page", () => {
  test("Scenario 1: populate form with current user", async ({
    page,
    context,
  }) => {
    const jake = `jake-${uniq()}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const settings = new SettingsPage(page);
    await settings.goto(WEB_URL);
    await settings.expectFormVisible();

    // Image + bio empty on a fresh user; username + email reflect registration.
    await settings.expectFormValues({
      image: "",
      username: jake,
      bio: "",
      email: `${jake}@jake.jake`,
      newPassword: "",
    });
  });

  test("Scenario 2: update bio succeeds and redirects to profile", async ({
    page,
    context,
  }) => {
    const jake = `jake-${uniq()}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const settings = new SettingsPage(page);
    await settings.goto(WEB_URL);
    await settings.fillForm({ bio: "I like cats" });
    await settings.submitUpdateAndWait(`${WEB_URL}/profile/${jake}`);

    // Persisted via API.
    const me = await jakeApi.get("/api/user");
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { user: { bio: string | null } };
    expect(body.user.bio).toBe("I like cats");
  });

  test("Scenario 3: duplicate email shows inline error and preserves inputs", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    const jakeSession = await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    await primeSession(context, jakeSession, jake);

    const settings = new SettingsPage(page);
    await settings.goto(WEB_URL);
    await settings.fillForm({ email: `${dan}@jake.jake` });
    await settings.submitUpdate();

    // Stays on /settings, inline error renders.
    await expect(page).toHaveURL(/\/settings/);
    await settings.expectErrorContains("email has already been taken");
    // The attempted (duplicate) email is preserved in the field.
    await settings.expectFormValues({ email: `${dan}@jake.jake` });
  });

  test("Scenario 4: password update issues fresh cookie and keeps user authed", async ({
    page,
    context,
  }) => {
    const jake = `jake-${uniq()}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const settings = new SettingsPage(page);
    await settings.goto(WEB_URL);
    await settings.fillForm({ newPassword: "newpassword" });
    await settings.submitUpdateAndWait(`${WEB_URL}/profile/${jake}`);

    // Verify no 401 on the next authed page — if the rotated token
    // wasn't written back, the navbar (which reads conduit-user) would
    // flip to signed-out chrome.
    const settingsRes = await page.goto(`${WEB_URL}/settings`);
    expect(settingsRes?.status()).toBe(200);
    // Cookie was rotated.
    const jar = await context.cookies(WEB_URL);
    const session2 = jar.find((c) => c.name === "conduit_session")?.value;
    expect(session2).toBeTruthy();
    expect(session2).not.toBe(session);
  });

  test("Scenario 5: logout clears cookies and lands on /", async ({
    page,
    context,
  }) => {
    const jake = `jake-${uniq()}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const settings = new SettingsPage(page);
    await settings.goto(WEB_URL);
    await settings.logout();

    await page.waitForURL(`${WEB_URL}/`);

    // conduit_session + conduit-user cleared from the jar.
    const jar = await context.cookies(WEB_URL);
    expect(jar.find((c) => c.name === "conduit_session")).toBeUndefined();
    expect(jar.find((c) => c.name === "conduit-user")).toBeUndefined();

    // Navbar now shows anon chrome.
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sign up" })).toBeVisible();
  });

  test("Scenario 6: /settings requires auth, redirects to /login?redirect=/settings", async ({
    page,
  }) => {
    const res = await page.goto(`${WEB_URL}/settings`);
    // Next follows redirects client-side, so the final URL is /login
    // with the original path preserved as `?redirect=/settings`.
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)settings$/);
    // Final status after redirect is 200 (the login page).
    expect(res?.status()).toBe(200);
  });
});

test("axe a11y gate on settings page (#87)", async ({ page, context }) => {
  const jake = `jake-${uniq()}`;
  const api = await apiContext();
  const session = await registerUser(api, jake);
  await primeSession(context, session, jake);
  await page.goto(`${WEB_URL}/settings`);
  await runAxe(page);
});

// ---------------------------------------------------------------
// #35 Phase 1 proof-of-shape → retained via #102 as the fixture-
// driven entry point. The authedContext fixture composes with
// SettingsPage cleanly; inline-primed Scenarios 1-5 remain for
// flows that need fresh-user / mutation semantics.
// ---------------------------------------------------------------

authedTest(
  "Scenario (via fixture): authed user lands on settings with prefilled form",
  async ({ authedContext, authedUser }) => {
    const page = await authedContext.newPage();
    try {
      const settings = new SettingsPage(page);
      await settings.goto(WEB_URL);
      await settings.expectFormVisible();
      await settings.expectFormValues({
        username: authedUser.username,
        email: `${authedUser.username}@jake.jake`,
      });
    } finally {
      await page.close();
    }
  },
);
