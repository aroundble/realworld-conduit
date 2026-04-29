import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { runAxe } from "../axe-config";
import { AuthPage } from "../page-objects/auth";

// BDD coverage for issue #16: register + login pages backed by Next.js
// Server Actions. Exercises the UI against the live compose web +
// API stack; nothing here mocks the API so a regression in the auth
// transport or the session-cookie handling also shows up here.
//
// Every DOM selector lives in AuthPage (tests/e2e/page-objects/auth.ts).
// Spec bodies describe user journeys.
//
// Each scenario gets a fresh user (unique email / username suffix) so
// runs are independent of DB state. The only precondition is "web +
// api + postgres healthy".

const SCREENSHOT_DIR = "tests/e2e/screenshots/16";
const SESSION_COOKIE = "conduit_session";
const USER_COOKIE = "conduit-user";

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`;

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
});

test.describe("issue #16 — web register / login", () => {
  test("Scenario 1: register with valid data lands logged in on /", async ({
    page,
    context,
  }) => {
    const username = `jake${uniq()}`;
    const auth = new AuthPage(page);

    await auth.registerNewUser({
      username,
      email: `${username}@jake.jake`,
      password: "jakejake",
    });

    await expect(page).toHaveURL(/\/$/);
    await auth.expectNavbarShowsUser(username);

    const cookieNames = (await context.cookies()).map((c) => c.name);
    expect(cookieNames).toContain(SESSION_COOKIE);
    expect(cookieNames).toContain(USER_COOKIE);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-1-register-success.png`,
    });
  });

  test("Scenario 2: duplicate email shows inline error and preserves inputs", async ({
    page,
  }) => {
    const id = uniq();
    const username = `jake${id}`;
    const email = `${username}@jake.jake`;
    const auth = new AuthPage(page);

    // Seed: register once, then log out by clearing cookies so the
    // second attempt sees the duplicate-email path, not the
    // "already authed → redirect" path.
    await auth.registerNewUser({ username, email, password: "jakejake" });
    await page.context().clearCookies();

    await auth.gotoRegister();
    const secondUsername = `dupe${id}`;
    await auth.fillRegisterForm({
      username: secondUsername,
      email,
      password: "jakejake",
    });
    await auth.submitRegisterNoWait();

    await expect(page).toHaveURL(/\/register/);
    await auth.expectErrorContains("email has already been taken");
    // Inputs are preserved — conform-to's reply() echoes submitted
    // values back on the next render.
    await expect(auth.usernameInput).toHaveValue(secondUsername);
    await expect(auth.emailInput).toHaveValue(email);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-2-duplicate-email.png`,
    });
  });

  test("Scenario 3: invalid input shows per-field errors and stays on /register", async ({
    page,
  }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await auth.usernameInput.fill("jake");
    await auth.emailInput.fill("notAnEmail");
    // Tab off email to trigger conform-to's onBlur validation.
    await auth.emailInput.press("Tab");
    await auth.submitRegisterNoWait();

    // Client-side zod intercepts the submit; the page never navigates.
    await expect(page).toHaveURL(/\/register/);
    await auth.expectErrorContains("email must be a valid email");
    await auth.expectErrorContains("password can't be blank");

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-3-invalid-input.png`,
    });
  });

  test("Scenario 4: login with correct credentials redirects to /", async ({
    page,
  }) => {
    const id = uniq();
    const username = `login${id}`;
    const email = `${username}@jake.jake`;
    const auth = new AuthPage(page);

    await auth.registerNewUser({ username, email, password: "jakejake" });
    await page.context().clearCookies();

    await auth.gotoLogin();
    await auth.fillLoginForm({ email, password: "jakejake" });
    await auth.submitLogin();

    await expect(page).toHaveURL(/\/$/);
    await auth.expectNavbarShowsUser(username);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-4-login-success.png`,
    });
  });

  test("Scenario 5: login with wrong password shows form-level error", async ({
    page,
  }) => {
    const id = uniq();
    const username = `wrong${id}`;
    const email = `${username}@jake.jake`;
    const auth = new AuthPage(page);

    await auth.registerNewUser({ username, email, password: "jakejake" });
    await page.context().clearCookies();

    await auth.gotoLogin();
    await auth.fillLoginForm({ email, password: "wrongwrong" });
    await auth.submitLoginNoWait();

    await expect(page).toHaveURL(/\/login/);
    await auth.expectErrorContains("email or password is invalid");

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-5-login-wrong-password.png`,
    });
  });

  test("Scenario 6: register works with JavaScript disabled (progressive enhancement)", async ({
    browser,
  }) => {
    // A fresh browser context with JS disabled simulates a visitor
    // who has toggled JS off in devtools. The <form action={action}>
    // still targets the Server Action endpoint; Next.js handles the
    // native POST without any client-side hydration.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const username = `nojs${uniq()}`;
    const auth = new AuthPage(page);

    await auth.registerNewUser({
      username,
      email: `${username}@jake.jake`,
      password: "jakejake",
    });

    await expect(page).toHaveURL(/\/$/);
    const cookieNames = (await context.cookies()).map((c) => c.name);
    expect(cookieNames).toContain(SESSION_COOKIE);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-6-progressive-enhancement.png`,
    });
    await context.close();
  });

  test("Scenario 7: already-authenticated visitor skips /login and /register", async ({
    page,
    context,
    baseURL,
  }) => {
    // Pretend the visitor is already authed by seeding the USER_COOKIE
    // directly — we don't need the real JWT for this scenario because
    // the redirect logic keys off cookie presence, not validity.
    const url = new URL(baseURL ?? "http://localhost:3100");
    await context.addCookies([
      {
        name: USER_COOKIE,
        value: encodeURIComponent(
          JSON.stringify({ username: "jake", image: null }),
        ),
        domain: url.hostname,
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    for (const path of ["/login", "/register"]) {
      const res = await page.goto(path);
      // Next.js redirects follow the 307/308 chain; the final URL is /.
      expect(res?.url()).toMatch(/\/$/);
      await expect(page).toHaveURL(/\/$/);
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-7-already-authed.png`,
    });
  });
});

test("axe a11y gate on auth routes (#87)", async ({ page }) => {
  for (const path of ["/login", "/register"]) {
    await page.goto(path);
    await runAxe(page);
  }
});
