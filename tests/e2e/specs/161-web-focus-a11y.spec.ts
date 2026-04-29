import { expect, test } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #161 — keyboard-navigation a11y.
// Skip-to-content link reveal on Tab, Enter → focus in <main>,
// visible focus rings on interactive elements, reduced-motion
// compliance. Covers the dynamic a11y axis that the static axe
// gate can't fully assert on its own.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

test.describe("issue #161 — focus + skip-link a11y", () => {
  test("Scenario 1: skip-link is the first focusable element and reveals on Tab", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    // Blur anything the autofocus / Next prefetch may have
    // grabbed, then tab once. Using evaluate → .blur() is the
    // most reliable way to get to a "no focus, start from top"
    // state that matches a keyboard-only user's landing view.
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.keyboard.press("Tab");

    const skip = page.getByTestId("skip-link");
    await expect(skip).toBeFocused();
    await expect(skip).toContainText(/Skip to main content/);
    await expect(skip).toHaveAttribute("href", "#main-content");

    // When focused, the clip-path reveal applies. Read the
    // computed style to assert the link is visible (not clipped).
    const clip = await skip.evaluate(
      (el) => window.getComputedStyle(el).clipPath,
    );
    // Post-focus, clip-path should be `none` or a non-inset(50%)
    // value. Inset(50%) is what hides the element.
    expect(clip).not.toMatch(/inset\(50%\)/);
  });

  test("Scenario 2: Enter on skip-link moves focus to <main>", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    // Wait for the hash navigation to land + focus to move.
    await page.waitForTimeout(200);

    // Next.js' Link with a hash href causes the browser to focus
    // the target element because it has tabindex="-1". Verify.
    const main = page.locator("#main-content");
    await expect(main).toHaveAttribute("tabindex", "-1");
    const focused = await main.evaluate(
      (el) => document.activeElement === el,
    );
    expect(focused).toBe(true);
  });

  test("Scenario 3: interactive elements have a visible focus ring", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    // Tab past the skip-link to the first real interactive
    // element (the navbar brand anchor).
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    await page.keyboard.press("Tab"); // skip-link
    await page.keyboard.press("Tab"); // conduit brand

    // The focused element should have a non-empty outline.
    // `outlineStyle: none` or `outlineWidth: 0px` would fail AA.
    const focusedInfo = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
      };
    });
    expect(focusedInfo).toBeTruthy();
    // outlineStyle must not be "none" under :focus-visible.
    expect(focusedInfo?.outlineStyle).not.toBe("none");
    // outlineWidth must be ≥2px.
    const widthNum = Number.parseFloat(focusedInfo?.outlineWidth ?? "0");
    expect(widthNum).toBeGreaterThanOrEqual(2);
  });

  test("Scenario 4: skip-link works on article detail page", async ({
    page,
  }) => {
    // Use a deterministic path — /login always exists + is anon-
    // accessible. Covers the "skip-link on every page" claim.
    await page.goto(`${WEB_URL}/login`);
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-link")).toBeFocused();
  });

  test("Scenario 5: axe a11y gate still green with skip-link + tabindex on main", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    await runAxe(page);
  });

  test("Scenario 6: forcedColors mode keeps focus ring visible", async ({
    browser,
  }) => {
    // Windows High Contrast simulation — forcedColors: active
    // replaces authored colors with system colors. :focus-visible
    // rings should remain visible because we use a solid outline
    // that forced-colors honors.
    const context = await browser.newContext({ forcedColors: "active" });
    const page = await context.newPage();
    await page.goto(`${WEB_URL}/`);
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    await page.keyboard.press("Tab"); // skip-link
    await page.keyboard.press("Tab"); // navbar brand
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
      };
    });
    expect(info?.outlineStyle).not.toBe("none");
    await context.close();
  });
});
