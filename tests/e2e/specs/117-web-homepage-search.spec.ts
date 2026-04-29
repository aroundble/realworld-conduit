import { expect, test } from "@playwright/test";
import { runAxe } from "../axe-config";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #117 web side: homepage SearchBar UX.
// Typing filters the list; URL is the source of truth.

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #117 — homepage SearchBar", () => {
  test("Scenario 1: typing filters the list + URL reflects ?q", async ({
    page,
  }) => {
    const id = uniq();
    const api = await ArticlesApi.newContext();
    await api.registerUser(`jake-${id}`);

    const needle = `NeedleW-${id}`;
    await api.createArticleReturnSlug({ title: `${needle} hit` });
    await api.createArticleReturnSlug({ title: `miss ${id}` });

    await page.goto(`${WEB_URL}/`);
    const input = page.getByTestId("search-bar-input");
    await input.fill(needle);

    // 300ms debounce + router.replace — wait for URL update + the
    // RSC re-render. Assert the "miss" row disappears via
    // toHaveCount expectation (auto-retries on Playwright's side).
    await page.waitForURL(
      (url) => url.searchParams.get("q") === needle,
      { timeout: 2000 },
    );

    // Wait for the filtered render to paint. Scoped to this spec's
    // id so parallel seeds don't leak in.
    await expect(
      page
        .locator(".article-preview h1")
        .filter({ hasText: `miss ${id}` }),
    ).toHaveCount(0, { timeout: 3000 });
    await expect(
      page
        .locator(".article-preview h1")
        .filter({ hasText: `${needle} hit` }),
    ).toBeVisible();
  });

  test("Scenario 2: Enter submits + Esc clears", async ({ page }) => {
    const id = uniq();
    const api = await ArticlesApi.newContext();
    await api.registerUser(`jake-${id}`);
    await api.createArticleReturnSlug({ title: `enter-${id} hit` });

    await page.goto(`${WEB_URL}/?q=nonsense-${id}`);
    const input = page.getByTestId("search-bar-input");
    await expect(input).toHaveValue(`nonsense-${id}`);

    await input.fill(`enter-${id}`);
    await input.press("Enter");
    await page.waitForURL((u) => u.searchParams.get("q") === `enter-${id}`, {
      timeout: 2000,
    });

    // Esc clears — URL drops the param, field empties.
    await input.press("Escape");
    await page.waitForURL((u) => !u.searchParams.has("q"), { timeout: 2000 });
    await expect(input).toHaveValue("");
  });

  test("Scenario 3: search composes with tag filter", async ({ page }) => {
    const id = uniq();
    const api = await ArticlesApi.newContext();
    await api.registerUser(`jake-${id}`);
    const tag = `compose-${id}`;
    await api.createArticleReturnSlug({
      title: `Keep ${id}`,
      tagList: [tag],
    });
    await api.createArticleReturnSlug({
      title: `Skip ${id}`,
      tagList: [tag],
    });

    await page.goto(`${WEB_URL}/?tag=${encodeURIComponent(tag)}`);
    const input = page.getByTestId("search-bar-input");
    await input.fill(`Keep`);
    await page.waitForURL(
      (u) =>
        u.searchParams.get("q") === "Keep" && u.searchParams.get("tag") === tag,
      { timeout: 2000 },
    );

    const titles = await page
      .locator(".article-preview h1")
      .allTextContents();
    const mine = titles.filter((t) => t.endsWith(` ${id}`));
    expect(mine).toEqual([`Keep ${id}`]);
  });

  test("Scenario 4: search input is keyboard-accessible + labelled", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);

    // Input has an accessible name via its <label for>.
    const input = page.getByRole("searchbox", { name: "Search articles" });
    await expect(input).toBeVisible();

    // Wrapping form is a search landmark.
    await expect(page.getByRole("search", { name: "Search articles" }))
      .toBeVisible();

    // Keyboard reachable via Tab. Focus navbar first link first,
    // then tab until we reach the input. We cap iterations to keep
    // the test bounded even if the navbar tab order changes.
    await page.keyboard.press("Tab");
    let hops = 0;
    while (hops < 30) {
      const focused = await page.evaluate(() => document.activeElement?.id ?? "");
      if (focused === "conduit-search") break;
      await page.keyboard.press("Tab");
      hops += 1;
    }
    expect(hops).toBeLessThan(30);

    await runAxe(page);
  });
});

void WEB_URL;
