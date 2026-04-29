import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// BDD coverage for issue #16: register + login pages backed by Next.js
// Server Actions. Exercises the UI against the live compose web +
// API stack; nothing here mocks the API so a regression in the auth
// transport or the session-cookie handling also shows up here.
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
    const id = uniq();
    const username = `jake${id}`;
    await page.goto("/register");
    await page.getByPlaceholder("Your Name").fill(username);
    await page.getByPlaceholder("Email").fill(`${username}@jake.jake`);
    await page.getByPlaceholder("Password").fill("jakejake");

    await Promise.all([
      page.waitForURL("**/"),
      page.getByRole("button", { name: "Sign up" }).click(),
    ]);

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.locator("nav.navbar").getByRole("link", { name: new RegExp(`@${username}`) }),
    ).toBeVisible();

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

    // Seed: register once, then log out by clearing cookies so the
    // second attempt sees the duplicate-email path, not the
    // "already authed → redirect" path.
    await page.goto("/register");
    await page.getByPlaceholder("Your Name").fill(username);
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("jakejake");
    await Promise.all([
      page.waitForURL("**/"),
      page.getByRole("button", { name: "Sign up" }).click(),
    ]);
    await page.context().clearCookies();

    await page.goto("/register");
    const secondUsername = `dupe${id}`;
    await page.getByPlaceholder("Your Name").fill(secondUsername);
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("jakejake");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator(".error-messages")).toContainText(
      "email has already been taken",
    );
    // Inputs are preserved — conform-to's reply() echoes submitted
    // values back on the next render.
    await expect(page.getByPlaceholder("Your Name")).toHaveValue(secondUsername);
    await expect(page.getByPlaceholder("Email")).toHaveValue(email);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/scenario-2-duplicate-email.png`,
    });
  });

  test("Scenario 3: invalid input shows per-field errors and stays on /register", async ({
    page,
  }) => {
    await page.goto("/register");

    await page.getByPlaceholder("Your Name").fill("jake");
    await page.getByPlaceholder("Email").fill("notAnEmail");
    // Tab off email to trigger conform-to's onBlur validation.
    await page.getByPlaceholder("Email").press("Tab");
    await page.getByRole("button", { name: "Sign up" }).click();

    // Client-side zod intercepts the submit; the page never navigates.
    await expect(page).toHaveURL(/\/register/);
    const errors = page.locator(".error-messages");
    await expect(errors).toContainText("email must be a valid email");
    await expect(errors).toContainText("password can't be blank");

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

    await page.goto("/register");
    await page.getByPlaceholder("Your Name").fill(username);
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("jakejake");
    await Promise.all([
      page.waitForURL("**/"),
      page.getByRole("button", { name: "Sign up" }).click(),
    ]);
    await page.context().clearCookies();

    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("jakejake");
    await Promise.all([
      page.waitForURL("**/"),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.locator("nav.navbar").getByRole("link", { name: new RegExp(`@${username}`) }),
    ).toBeVisible();

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

    await page.goto("/register");
    await page.getByPlaceholder("Your Name").fill(username);
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("jakejake");
    await Promise.all([
      page.waitForURL("**/"),
      page.getByRole("button", { name: "Sign up" }).click(),
    ]);
    await page.context().clearCookies();

    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("wrongwrong");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator(".error-messages")).toContainText(
      "email or password is invalid",
    );

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
    const id = uniq();
    const username = `nojs${id}`;

    await page.goto("/register");
    await page.getByPlaceholder("Your Name").fill(username);
    await page.getByPlaceholder("Email").fill(`${username}@jake.jake`);
    await page.getByPlaceholder("Password").fill("jakejake");

    await Promise.all([
      page.waitForURL("**/"),
      page.getByRole("button", { name: "Sign up" }).click(),
    ]);
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
