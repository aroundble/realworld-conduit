import { expect, test } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #160 — keyboard shortcuts:
//   ?   open help modal
//   /   focus search bar
//   g h → home
//   g p → profile (or /login?redirect=/profile when anon)
//   n   → editor (or /login?redirect=/editor when anon)
//   Esc close modal
//
// Each scenario uses page.keyboard.press to exercise the global
// keydown handler installed by KeyboardShortcutProvider. The
// input-field guard is verified by typing "?" inside a textarea
// and asserting the modal does NOT open.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

// Wait for the KeyboardShortcutProvider to finish its useEffect
// pass — the provider attaches the global keydown listener in
// an effect, so a keypress fired before React hydration is
// silently dropped. Polling for the provider's ready marker is
// faster + more deterministic than networkidle (which waits for
// every image + font on a Suspense-streaming homepage). The
// provider writes a data attribute on <body> once the effect has
// mounted; the spec just polls for it.
const waitForShortcutsReady = async (page: import("@playwright/test").Page) => {
  await page.waitForFunction(
    () => document.body.dataset.shortcutsReady === "1",
    null,
    { timeout: 5000 },
  );
};

test.describe("issue #160 — keyboard shortcuts", () => {
  test("Scenario 1: `?` opens the help modal", async ({ page }) => {
    await page.goto(`${WEB_URL}/`);
    await waitForShortcutsReady(page);
    await page.keyboard.press("Shift+?");
    const dialog = page.getByTestId("shortcut-help");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    // Close button has initial focus per the AC.
    await expect(page.getByTestId("shortcut-help-close")).toBeFocused();
  });

  test("Scenario 2: Esc closes the modal", async ({ page }) => {
    await page.goto(`${WEB_URL}/`);
    await waitForShortcutsReady(page);
    await page.keyboard.press("Shift+?");
    await expect(page.getByTestId("shortcut-help")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcut-help")).toHaveCount(0);
  });

  test("Scenario 3: `/` focuses the search bar on the homepage", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    await waitForShortcutsReady(page);
    // Blur any auto-focus target so the / keystroke doesn't
    // race an existing text field.
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.keyboard.press("/");
    // The SearchBar from #117 renders an input[name=q] /
    // type=search. Either selector should match.
    const search = page.locator(
      'input[type="search"], [role="searchbox"], input[name="q"]',
    );
    await expect(search.first()).toBeFocused();
  });

  test("Scenario 4: `g h` navigates to home", async ({ page }) => {
    await page.goto(`${WEB_URL}/login`);
    await waitForShortcutsReady(page);
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await page.waitForURL(`${WEB_URL}/`);
    expect(page.url()).toBe(`${WEB_URL}/`);
  });

  test("Scenario 5: `n` opens the editor when anon — routes to /login?redirect", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    await waitForShortcutsReady(page);
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.keyboard.press("n");
    await page.waitForURL(/\/login\?redirect=/);
    expect(page.url()).toContain("login");
    expect(page.url()).toContain("redirect");
  });

  test("Scenario 6: shortcuts don't fire inside form fields", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/login`);
    await waitForShortcutsReady(page);
    // Focus the email input so typing `?` is text, not
    // the modal trigger.
    const emailInput = page.locator('input[type="email"]');
    await emailInput.focus();
    await page.keyboard.type("hi?");
    // Help modal must NOT be open.
    await expect(page.getByTestId("shortcut-help")).toHaveCount(0);
    // The `?` made it into the field.
    await expect(emailInput).toHaveValue("hi?");
  });

  test("Scenario 7: footer link opens the modal", async ({ page }) => {
    await page.goto(`${WEB_URL}/`);
    await waitForShortcutsReady(page);
    await page.getByTestId("shortcut-help-trigger").click();
    await expect(page.getByTestId("shortcut-help")).toBeVisible();
  });

  test("Scenario 8: axe a11y gate on the help modal", async ({ page }) => {
    await page.goto(`${WEB_URL}/`);
    await waitForShortcutsReady(page);
    await page.keyboard.press("Shift+?");
    await expect(page.getByTestId("shortcut-help")).toBeVisible();
    await runAxe(page);
  });

  test("Scenario 9: Tab cycles within the modal", async ({ page }) => {
    await page.goto(`${WEB_URL}/`);
    await waitForShortcutsReady(page);
    await page.keyboard.press("Shift+?");
    const dialog = page.getByTestId("shortcut-help");
    await expect(dialog).toBeVisible();
    // Initial focus is on Close. Tab once — with only the Close
    // button inside, Tab should wrap back to itself. Press Tab
    // then confirm focus is still on Close.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("shortcut-help-close")).toBeFocused();
  });
});
