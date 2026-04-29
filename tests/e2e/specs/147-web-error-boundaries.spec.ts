import { expect, test } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #147 — per-segment error.tsx boundaries.
// Uses the dev-only /throwtest route that deliberately throws so
// Playwright can exercise the boundary without mocking server-side
// RSC fetches.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

test.describe("issue #147 — error boundaries", () => {
  test("Scenario 1: root segment error.tsx renders branded UI on a thrown page", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/throwtest`);

    const banner = page.getByTestId("error-home");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Something went wrong/);
    await expect(banner).toHaveAttribute("role", "alert");

    // Retry button must be present and call reset() — clicking it
    // causes Next to re-render the segment, which will throw again
    // (the page still throws), so the boundary persists. We just
    // verify the click doesn't crash and the boundary is still
    // shown.
    const retry = page.getByTestId("error-retry");
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(banner).toBeVisible();

    // Home link is an anchor to /, not a button.
    const home = page.getByRole("link", { name: /Back to homepage/ });
    await expect(home).toHaveAttribute("href", "/");
  });

  test("Scenario 2: layout chrome (navbar + footer) still renders on the error page", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/throwtest`);

    // Error boundary replaces <main> content but layout chrome
    // from the root layout continues to render.
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    // The branded error card is inside <main>.
    await expect(page.getByTestId("error-home")).toBeVisible();
  });

  test("Scenario 3: axe a11y gate on the error UI", async ({ page }) => {
    await page.goto(`${WEB_URL}/throwtest`);
    await expect(page.getByTestId("error-home")).toBeVisible();
    await runAxe(page);
  });

  test("Scenario 4: error digest surfaces to support-reference label when present", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/throwtest`);
    const banner = page.getByTestId("error-home");
    await expect(banner).toBeVisible();

    // The digest is added by Next.js in production builds. In dev
    // builds it may be undefined — so we check: if the digest
    // element is present, it contains a non-empty code fragment;
    // if it's not present, that's also valid (dev mode).
    const digest = page.getByTestId("error-digest");
    if ((await digest.count()) > 0) {
      await expect(digest).toContainText(/Support reference/);
      await expect(digest.locator("code")).not.toHaveText("");
    }
  });
});
