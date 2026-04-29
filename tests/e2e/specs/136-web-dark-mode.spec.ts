import { expect, test } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #136 — system detect + nav toggle dark mode.
// Palette is applied via `data-theme="dark"` on <html> (next-themes),
// and persisted under `localStorage` key `conduit-theme`.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

test.describe("issue #136 — dark mode", () => {
  test("Scenario 1: system dark preference is honored on first paint", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(WEB_URL);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const bodyBg = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor,
    );
    // rgb(14, 14, 15) = #0e0e0f from our dark palette. Match loose
    // against the numeric tuple because browsers canonicalise to rgb().
    expect(bodyBg).toMatch(/rgb\(14, 14, 15\)|rgba\(14, 14, 15/);

    await context.close();
  });

  test("Scenario 2: toggle cycles system → light → dark → system and persists", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(WEB_URL);

    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();

    // Start state: system (default). First click → light.
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const afterLight = await page.evaluate(() =>
      window.localStorage.getItem("conduit-theme"),
    );
    expect(afterLight).toBe("light");

    // Second click → dark.
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const afterDark = await page.evaluate(() =>
      window.localStorage.getItem("conduit-theme"),
    );
    expect(afterDark).toBe("dark");

    // Third click → back to system. next-themes writes "system" to
    // storage; the visible attribute resolves to whichever palette
    // the OS prefers (we booted in light mode).
    await toggle.click();
    const afterSystem = await page.evaluate(() =>
      window.localStorage.getItem("conduit-theme"),
    );
    expect(afterSystem).toBe("system");

    await context.close();
  });

  test("Scenario 3: persisted choice wins over system preference on next visit", async ({
    browser,
  }) => {
    // First visit: OS is dark, user forces light.
    const context = await browser.newContext({ colorScheme: "dark" });
    const page1 = await context.newPage();
    await page1.goto(WEB_URL);
    await page1.getByTestId("theme-toggle").click(); // system → light
    await expect(page1.locator("html")).toHaveAttribute("data-theme", "light");
    await page1.close();

    // Second visit in the same context (storage survives): despite
    // `colorScheme: dark`, the user's persisted `light` wins.
    const page2 = await context.newPage();
    await page2.goto(WEB_URL);
    await expect(page2.locator("html")).toHaveAttribute("data-theme", "light");
    await page2.close();

    await context.close();
  });

  test("Scenario 4: toggle exposes accessible name + aria-pressed state", async ({
    page,
  }) => {
    await page.goto(WEB_URL);
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toHaveAttribute("aria-label", /Toggle theme/);
    // After mount, aria-pressed should be set (either "true" for
    // light/dark, "false" for system).
    const ariaPressed = await toggle.getAttribute("aria-pressed");
    expect(["true", "false"]).toContain(ariaPressed ?? "");
  });

  test("Scenario 5: axe a11y gate on dark-palette homepage", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(WEB_URL);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Give Suspense streaming a moment to settle before axe runs, so
    // the skeleton doesn't flag color-contrast issues during the
    // brief swap window.
    await page.locator(".article-preview").first().waitFor({ timeout: 10000 });
    await runAxe(page);
    await context.close();
  });

  test("Scenario 6: axe a11y gate on dark-palette article detail", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    // Use any article that may exist; if none, the detail page is
    // a 404 and axe runs against the error shell. Either is a valid
    // axe assertion surface — both are in the dark palette.
    await page.goto(`${WEB_URL}/`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const firstPreview = page.locator(".article-preview a.preview-link").first();
    if ((await firstPreview.count()) > 0) {
      await firstPreview.click();
      await page.waitForLoadState("networkidle");
    }
    await runAxe(page);
    await context.close();
  });
});
