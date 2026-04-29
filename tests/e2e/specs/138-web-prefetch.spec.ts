import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";
import { runAxe } from "../axe-config";

// BDD coverage for issue #138 — article-card prefetch on hover.
// The outer preview Link calls router.prefetch(href) on mouse
// enter + focus; the Save-Data / prefers-reduced-data signals
// suppress the prefetch.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Network-log helper: accumulate every request URL that Playwright
// observes on this page. The per-scenario setup starts fresh so
// we can query "was this path fetched" without cross-test bleed.
const recordRequests = (page: import("@playwright/test").Page): string[] => {
  const log: string[] = [];
  page.on("request", (req) => log.push(req.url()));
  return log;
};

test.describe("issue #138 — article-card prefetch on hover", () => {
  test("Scenario 1: hovering a preview triggers a prefetch for the article detail", async ({
    browser,
  }) => {
    // Seed a known article so we can grep for its slug in the
    // network log and rule out noise from other previews.
    const id = uniq();
    const jake = `pf-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `pf-${id}` });

    const context = await browser.newContext();
    const page = await context.newPage();
    const log = recordRequests(page);

    await page.goto(`${WEB_URL}/`);
    const preview = page.locator(
      `.article-preview:has(a[href="/article/${slug}"])`,
    );
    await expect(preview).toBeVisible();
    const beforeHover = log.length;

    // Hover the outer preview link and give Next a moment to
    // dispatch the prefetch. 250ms is well above the 50ms AC
    // floor and well below what would time out a fast local
    // stack.
    await preview.getByTestId("article-preview-link").hover();
    await page.waitForTimeout(250);

    // Check at least one new request went to the article's URL
    // after the hover (either the bare path or with Next's RSC
    // query string — both are valid prefetch signatures).
    const after = log.slice(beforeHover);
    const matched = after.some((url) =>
      url.includes(`/article/${slug}`),
    );
    expect(matched).toBe(true);

    await context.close();
  });

  test("Scenario 2: Save-Data suppresses hover-triggered prefetch", async ({
    browser,
  }) => {
    // Seed a unique article so its slug doesn't collide with any
    // other seed, and so a viewport-triggered prefetch on
    // neighboring cards doesn't mask the "did THIS slug fetch
    // after hover" signal.
    const id = uniq();
    const jake = `pf-sd-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `pfsd-${id}` });

    const context = await browser.newContext();
    // Stub saveData before any page script runs. The hook reads
    // navigator.connection at handler-invoke time.
    await context.addInitScript(() => {
      try {
        Object.defineProperty(window.navigator, "connection", {
          configurable: true,
          get: () => ({ saveData: true }),
        });
      } catch {
        /* browser refused the override — best-effort */
      }
    });

    const page = await context.newPage();
    const log = recordRequests(page);
    await page.goto(`${WEB_URL}/`);

    // Probe: verify the stub took. If the browser refused the
    // override, skip rather than run a vacuous assertion.
    const saveDataOn = await page.evaluate(() => {
      const conn = (
        window.navigator as Navigator & {
          connection?: { saveData?: boolean };
        }
      ).connection;
      return conn?.saveData === true;
    });
    test.skip(
      !saveDataOn,
      "browser refused navigator.connection override — can't assert Save-Data gate",
    );

    const preview = page.locator(
      `.article-preview:has(a[href="/article/${slug}"])`,
    );
    await expect(preview).toBeVisible();
    // Wait for the page to go network-idle so viewport prefetches
    // (Next's own IntersectionObserver-based path) complete before
    // we test the hover path.
    await page.waitForLoadState("networkidle");
    const beforeHover = log.length;

    await preview.getByTestId("article-preview-link").hover();
    await page.waitForTimeout(300);

    // With Save-Data on, the hover hook must no-op. Count new
    // requests to this slug AFTER the hover; should be zero
    // (viewport prefetches already fired pre-idle-wait).
    const hoverFetches = log
      .slice(beforeHover)
      .filter((url) => url.includes(`/article/${slug}`));
    expect(hoverFetches).toEqual([]);

    await context.close();
  });

  test("Scenario 3: axe a11y gate on homepage with prefetch wiring", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    // Ensure a card has rendered so axe scans the prefetch link
    // surface, not a blank feed.
    await page.locator(".article-preview").first().waitFor({ timeout: 10000 });
    await runAxe(page);
  });
});
