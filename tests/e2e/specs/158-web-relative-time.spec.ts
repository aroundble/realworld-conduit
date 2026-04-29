import { expect, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";
import { runAxe } from "../axe-config";

// BDD coverage for issue #158 — relative time labels with formal
// date on hover. The RelativeTime client component renders the
// formal date on SSR + first client render (for SEO + hydration
// parity), then swaps to the relative label after hydration
// + refreshes every 60s via a shared tick store.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #158 — relative time labels", () => {
  test("Scenario 1: preview card renders relative time after hydration", async ({
    page,
  }) => {
    // Seed a fresh article — "just now" is the expected label.
    const id = uniq();
    const jake = `rt-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `rt-${id}` });

    await page.goto(`${WEB_URL}/profile/${jake}`);
    const preview = page.locator(
      `.article-preview:has(a[href="/article/${slug}"])`,
    );
    await expect(preview).toBeVisible();

    // Post-hydration, the RelativeTime label flips to the
    // relative form. "just now" is deterministic for a
    // fresh-seeded article.
    const time = preview.getByTestId("relative-time").first();
    await expect(time).toContainText(/just now|seconds ago|minute/);
  });

  test("Scenario 2: <time> carries datetime + title attributes", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rtm-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `rtm-${id}` });

    await page.goto(`${WEB_URL}/article/${slug}`);
    const time = page.getByTestId("relative-time").first();
    await expect(time).toBeVisible();

    // Machine-readable ISO in datetime — crawlers + screen
    // readers consume this.
    const dt = await time.getAttribute("datetime");
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Formal date in title — hover reveal for the human who
    // wants unambiguous time info.
    const title = await time.getAttribute("title");
    expect(title).toBeTruthy();
    expect(title).toMatch(/\d{4}/); // year is always present
    expect(title).toMatch(/\w+ \d+/); // month + day words
  });

  test("Scenario 3: article detail shows relative time in both meta strips", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rtd-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `rtd-${id}` });

    await page.goto(`${WEB_URL}/article/${slug}`);
    const times = page.getByTestId("relative-time");
    // Banner meta + footer meta both render ArticleMeta, so we
    // expect at least 2 <time> elements on the detail page.
    const count = await times.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("Scenario 4: comments show relative time per item", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rtc-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `rtc-${id}` });
    await api.api.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: `rt-comment-${id}` } },
    });

    await page.goto(`${WEB_URL}/article/${slug}`);
    const comment = page.locator('[data-testid="comment-list"] > *').first();
    await expect(comment).toBeVisible();
    const time = comment.getByTestId("relative-time");
    await expect(time).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
    await expect(time).toContainText(/just now|seconds ago|minute/);
  });

  test("Scenario 5: axe a11y gate on page with relative times", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rta-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    await api.createArticleReturnSlug({ title: `rta-${id}` });

    await page.goto(`${WEB_URL}/profile/${jake}`);
    await expect(
      page.getByTestId("relative-time").first(),
    ).toBeVisible();
    await runAxe(page);
  });
});
