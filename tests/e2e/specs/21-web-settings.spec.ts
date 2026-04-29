import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #21: settings page (#21).
// Six scenarios matching the AC block.

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
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/settings`);
    const form = page.getByRole("form", { name: "Settings" });
    await expect(form).toBeVisible();

    // Image + bio empty on a fresh user; username + email reflect registration.
    await expect(form.getByPlaceholder("URL of profile picture")).toHaveValue("");
    await expect(form.getByPlaceholder("Your Name")).toHaveValue(jake);
    await expect(form.getByPlaceholder("Short bio about you")).toHaveValue("");
    await expect(form.getByPlaceholder("Email")).toHaveValue(`${jake}@jake.jake`);
    await expect(form.getByPlaceholder("New Password")).toHaveValue("");
  });

  test("Scenario 2: update bio succeeds and redirects to profile", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/settings`);
    const form = page.getByRole("form", { name: "Settings" });
    await form.getByPlaceholder("Short bio about you").fill("I like cats");
    await form.getByRole("button", { name: "Update Settings" }).click();

    await page.waitForURL(`${WEB_URL}/profile/${jake}`);

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

    await page.goto(`${WEB_URL}/settings`);
    const form = page.getByRole("form", { name: "Settings" });
    const email = form.getByPlaceholder("Email");
    await email.fill(`${dan}@jake.jake`);
    await form.getByRole("button", { name: "Update Settings" }).click();

    // Stays on /settings, inline error renders.
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator(".error-messages")).toContainText(
      "email has already been taken",
    );
    // The attempted (duplicate) email is preserved in the field.
    await expect(email).toHaveValue(`${dan}@jake.jake`);
  });

  test("Scenario 4: password update issues fresh cookie and keeps user authed", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/settings`);
    const form = page.getByRole("form", { name: "Settings" });
    await form.getByPlaceholder("New Password").fill("newpassword");
    await form.getByRole("button", { name: "Update Settings" }).click();

    await page.waitForURL(`${WEB_URL}/profile/${jake}`);

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
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/settings`);
    await page
      .getByRole("button", { name: /Or click here to logout/ })
      .click();

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
  const id = uniq();
  const jake = `jake-${id}`;
  const api = await apiContext();
  const session = await registerUser(api, jake);
  await primeSession(context, session, jake);
  await page.goto(`${WEB_URL}/settings`);
  await runAxe(page);
});

// ---------------------------------------------------------------
// #35 Phase 1 — fixture-driven scenario (proof of shape).
//
// The existing Scenarios 1-6 above prime the session inline via the
// per-test `primeSession()` helper. This block uses the new
// `authedContext` fixture from tests/e2e/fixtures/authStorage.ts
// instead — suite-level user (per-worker), shared cookies. As
// Phase 2 per-feature PRs migrate each spec, the inline
// primeSession pattern goes away in favour of this fixture.
// ---------------------------------------------------------------

import { test as authedTest } from "../fixtures/authStorage";

authedTest(
  "Scenario (via fixture): authed user lands on settings with prefilled form",
  async ({ authedContext, authedUser }) => {
    const page = await authedContext.newPage();
    try {
      await page.goto(`${WEB_URL}/settings`);
      const form = page.getByRole("form", { name: "Settings" });
      await expect(form).toBeVisible();
      await expect(form.getByPlaceholder("Your Name")).toHaveValue(
        authedUser.username,
      );
      await expect(form.getByPlaceholder("Email")).toHaveValue(
        `${authedUser.username}@jake.jake`,
      );
    } finally {
      await page.close();
    }
  },
);
