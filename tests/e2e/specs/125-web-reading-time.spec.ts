import { expect, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #125 — server-computed read-time estimate.
// The API envelope carries `readingTimeMinutes` on every article
// surface; the web renders "N min read" in the article-meta strip
// on both preview cards and the detail page.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Helper: build a body with `n` whitespace-separated words.
const bodyOf = (wordCount: number): string =>
  Array.from({ length: wordCount }, (_, i) => `w${i}`).join(" ");

test.describe("issue #125 — article read-time estimate", () => {
  test("Scenario 1: API envelope includes readingTimeMinutes on single + list", async () => {
    const id = uniq();
    const jake = `rt-a-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    // 476 words → ceil(476/238) = 2 minutes per the AC.
    const article = await api.createArticle({
      title: `rt-${id}`,
      body: bodyOf(476),
    });
    expect(article.readingTimeMinutes).toBe(2);

    // List endpoint echoes the same value for the body-less envelope.
    const list = await api.listArticles({ author: jake });
    const listed = list.articles.find((a) => a.slug === article.slug);
    expect(listed?.readingTimeMinutes).toBe(2);
  });

  test("Scenario 2: preview card shows N min read next to the date", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rt-p-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    // 1000 words → ceil(1000/238) = 5 min.
    const article = await api.createArticle({
      title: `rt-pv-${id}`,
      body: bodyOf(1000),
    });

    await page.goto(`${WEB_URL}/profile/${jake}`);
    // Scope to the preview for THIS article so parallel seeds don't
    // leak another author's read-time into our assertion.
    const preview = page.locator(
      `.article-preview:has(a[href="/article/${article.slug}"])`,
    );
    await expect(preview.getByTestId("read-time")).toContainText("5 min read");
  });

  test("Scenario 3: article detail page shows the read time in both meta strips", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rt-d-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    // 239 words → ceil(239/238) = 2 min (one over the boundary).
    const article = await api.createArticle({
      title: `rt-dt-${id}`,
      body: bodyOf(239),
    });

    await page.goto(`${WEB_URL}/article/${article.slug}`);
    // Banner + footer meta both render ArticleMeta → both emit the
    // read-time testid. Check .count() ≥ 2 so the feature surfaces
    // in both positions like the AC demands.
    const readTimes = page.getByTestId("read-time");
    await expect(readTimes.first()).toBeVisible();
    await expect(readTimes.first()).toContainText("2 min read");
    expect(await readTimes.count()).toBeGreaterThanOrEqual(2);
  });

  test("Scenario 4: minimum 1 min for a short body (below the 238-word boundary)", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rt-s-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    // 10 words → ceil(10/238) = 1 min (floor is 1, never 0).
    const article = await api.createArticle({
      title: `rt-sh-${id}`,
      body: bodyOf(10),
    });
    expect(article.readingTimeMinutes).toBe(1);

    await page.goto(`${WEB_URL}/article/${article.slug}`);
    await expect(page.getByTestId("read-time").first()).toContainText(
      "1 min read",
    );
  });
});
