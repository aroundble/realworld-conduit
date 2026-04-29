import { expect, request, test } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #149 — PWA manifest + icons + theme-color
// + apple-touch-icon + no-op service worker. Covers the install-
// ability contract (192 + 512 icons, standalone display, SW
// registers). Full offline-first strategy is a separate issue.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

test.describe("issue #149 — PWA manifest", () => {
  test("Scenario 1: /manifest.webmanifest returns valid JSON with required fields", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/manifest.webmanifest`);
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toMatch(/manifest\+json|application\/json/);

    const manifest = (await res.json()) as Record<string, unknown>;
    expect(manifest.name).toBe("Conduit");
    expect(manifest.short_name).toBe("Conduit");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#2c7a2c");
    expect(manifest.background_color).toBeTruthy();

    const icons = manifest.icons as Array<Record<string, unknown>>;
    expect(Array.isArray(icons)).toBe(true);
    // Chrome installability: needs at least one 192 and one 512.
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    // Maskable icon recommended for nicer Android home-screen
    // integration.
    const maskable = icons.find((i) => i.purpose === "maskable");
    expect(maskable).toBeTruthy();
  });

  test("Scenario 2: icon files exist and serve as image/png", async () => {
    const ctx = await request.newContext();
    for (const path of [
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-512-maskable.png",
      "/icons/apple-touch-icon.png",
    ]) {
      const res = await ctx.get(`${WEB_URL}${path}`);
      expect(res.status(), path).toBe(200);
      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType, path).toMatch(/image\/png/);
    }
  });

  test("Scenario 3: HTML head references manifest + theme-color + apple-touch-icon", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    // Manifest link.
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute("href", /manifest\.webmanifest$/);

    // theme-color — Next 16 emits two <meta> tags when viewport
    // passes the media-based array, one per prefers-color-scheme.
    const themeMetas = page.locator('meta[name="theme-color"]');
    const themeCount = await themeMetas.count();
    expect(themeCount).toBeGreaterThanOrEqual(1);

    // apple-touch-icon.
    const appleLink = page.locator(
      'link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]',
    );
    await expect(appleLink.first()).toHaveAttribute(
      "href",
      /apple-touch-icon\.png$/,
    );
  });

  test("Scenario 4: service worker file serves with correct content-type", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/sw.js`);
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toMatch(/javascript/);
    const body = await res.text();
    // Quick structural check: the file must register handlers for
    // at least `install` + `fetch` so Chrome treats it as a real
    // SW for installability.
    expect(body).toMatch(/addEventListener\(\s*["']install["']/);
    expect(body).toMatch(/addEventListener\(\s*["']fetch["']/);
  });

  test("Scenario 5: service worker registers in the browser", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    // Wait for the registration. `navigator.serviceWorker.ready`
    // resolves once a SW is active for the scope. Give it 10s
    // since first registration can race with hydration.
    const registered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      try {
        await navigator.serviceWorker.ready;
        return true;
      } catch {
        return false;
      }
    });
    expect(registered).toBe(true);
  });

  test("Scenario 6: axe a11y gate on page with PWA wiring", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    // Confirm the manifest link rendered (via a head query) before
    // running axe, so the assertion couldn't spuriously pass on an
    // empty page.
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await runAxe(page);
  });
});
