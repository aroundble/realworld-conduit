import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { runAxe } from "../axe-config";

const SCREENSHOT_DIR = "tests/e2e/screenshots/15";
const AUTH_COOKIE_NAME = "conduit-user";
// `/article/[slug]` and `/profile/[username]` are excluded from this
// always-200 list because they reflect real data after #18 / #20: a
// non-existent slug/username returns 404 with a helpful "not found"
// page instead of a ComingSoon stub. Layout-shell coverage for those
// routes lives in 18-web-article-detail.spec.ts and the profile spec.
const PROTECTED_ROUTES = [
  "/",
  "/login",
  "/register",
  "/settings",
  "/editor",
];

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
});

test("anonymous navbar shows Home / Sign in / Sign up and hides authed links", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const navbar = page.locator("nav.navbar");
  await expect(navbar.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
  await expect(navbar.getByRole("link", { name: "Sign up" })).toHaveAttribute(
    "href",
    "/register",
  );
  await expect(navbar.getByRole("link", { name: /New Article/ })).toHaveCount(
    0,
  );
  await expect(navbar.getByRole("link", { name: /Settings/ })).toHaveCount(0);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/scenario-1-anonymous.png` });
});

test("authenticated navbar shows New Article / Settings / @username and hides anonymous links", async ({
  page,
  context,
  baseURL,
}) => {
  const url = new URL(baseURL ?? "http://localhost:3100");
  await context.addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: JSON.stringify({ username: "jake" }),
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const navbar = page.locator("nav.navbar");
  await expect(navbar.getByRole("link", { name: /New Article/ })).toHaveAttribute(
    "href",
    "/editor",
  );
  await expect(navbar.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  await expect(navbar.getByRole("link", { name: /@jake/ })).toHaveAttribute(
    "href",
    "/profile/jake",
  );
  await expect(navbar.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(navbar.getByRole("link", { name: "Sign up" })).toHaveCount(0);

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/scenario-2-authenticated.png`,
  });
});

test("footer renders on every page with attribution + spec link", async ({
  page,
}) => {
  for (const path of ["/", "/login", "/settings"]) {
    await page.goto(path);
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(footer.getByRole("link", { name: "Thinkster" })).toHaveAttribute(
      "href",
      "https://thinkster.io",
    );
    await expect(
      footer.getByRole("link", { name: "RealWorld spec" }),
    ).toHaveAttribute("href", "https://realworld-docs.netlify.app/");
  }
  await page.screenshot({ path: `${SCREENSHOT_DIR}/scenario-3-footer.png` });
});

test("all spec-mandated routes return HTTP 200 with non-empty HTML", async ({
  request,
}) => {
  for (const path of PROTECTED_ROUTES) {
    const response = await request.get(path);
    expect(response.status(), `route ${path}`).toBe(200);
    const body = await response.text();
    expect(body.length, `route ${path} body length`).toBeGreaterThan(1000);
  }
});

test("canonical RealWorld styling — Source Sans Pro + green navbar + banner", async ({
  page,
}) => {
  await page.goto("/");

  const bodyFontFamily = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(bodyFontFamily).toContain("Source Sans Pro");

  const bannerBg = await page
    .locator(".home-page .banner")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // Palette deviation per #90 — darker green #2c7a2c for WCAG AA
  // compliance on the white-on-green banner. Canonical #5cb85c
  // (rgb 92,184,92) failed AA; rgb(44,122,44) passes at ratio 5.53.
  expect(bannerBg).toBe("rgb(44, 122, 44)");

  await page.screenshot({ path: `${SCREENSHOT_DIR}/scenario-5-styling.png` });
});

test("axe a11y gate on layout-shell anon routes (#87)", async ({ page }) => {
  for (const path of PROTECTED_ROUTES) {
    await page.goto(path);
    await runAxe(page);
  }
});
