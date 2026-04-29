import { expect, test } from "@playwright/test";
import { runAxe } from "../axe-config";
import { FavoritesApi } from "../page-objects/favorite";

// BDD coverage for issue #114: loading.tsx + Suspense streaming
// skeletons. Proves:
//   - Each skeleton component renders during the Suspense pending window.
//   - The real content eventually replaces the skeleton.
//   - Skeleton containers carry aria-busy="true".
//   - axe gate passes on the skeleton state.
//
// Slow-mode induction: the server components accept a `?slow=<ms>`
// querystring that inserts a deliberate delay before the inner fetch
// resolves — gated on CONDUIT_TEST_SLOW_SUSPENSE=1 (compose env) so
// non-dev builds never honour it. See apps/web/src/app/page.tsx
// `testSlowMs`.
//
// Note: the test body sets a small number (1500ms) — enough to catch
// the Suspense fallback + swap without bloating spec wall-clock.

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SLOW = 1500;

test.describe("issue #114 — Suspense streaming skeletons", () => {
  test("Scenario 1: article detail paints banner immediately and streams comments behind a skeleton", async ({
    page,
  }) => {
    const id = uniq();
    const api = await FavoritesApi.newContext();
    const jake = `jake-${id}`;
    await api.registerUser(jake);
    const slug = await api.createArticle(`Stream ${id}`);

    // Don't wait for 'load' — Playwright would block until the
    // stream completes and the skeleton would have swapped out
    // already. 'commit' returns as soon as the navigation commits,
    // letting us assert the pre-stream-complete DOM.
    await page.goto(`${WEB_URL}/article/${slug}?slow=${SLOW}`, {
      waitUntil: "commit",
    });

    // Banner rendered + comments skeleton visible.
    await expect(page.locator(".banner h1")).toHaveText(`Stream ${id}`);
    const skeleton = page.getByTestId("comments-skeleton").first();
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");

    // Skeleton swaps for the real comments section.
    await expect(skeleton).toBeHidden({ timeout: 5000 });
    await expect(
      page.locator("section[aria-label='Comments']"),
    ).toBeVisible();
  });

  test("Scenario 2: homepage paints article list and streams tag cloud behind a skeleton", async ({
    page,
  }) => {
    const id = uniq();
    const api = await FavoritesApi.newContext();
    await api.registerUser(`jake-${id}`);
    await api.createArticle(`Home stream ${id}`);

    await page.goto(`${WEB_URL}/?slow=${SLOW}`, { waitUntil: "commit" });

    await expect(page.locator(".article-preview").first()).toBeVisible();
    const tagSkeleton = page.getByTestId("tag-cloud-skeleton").first();
    await expect(tagSkeleton).toBeVisible();
    await expect(tagSkeleton).toHaveAttribute("aria-busy", "true");

    await expect(tagSkeleton).toBeHidden({ timeout: 5000 });
    await expect(page.locator(".sidebar")).toContainText("Popular Tags");
  });

  test("Scenario 3: profile page paints banner and streams article tab content", async ({
    page,
  }) => {
    const id = uniq();
    const api = await FavoritesApi.newContext();
    const jake = `jake-${id}`;
    await api.registerUser(jake);
    await api.createArticle(`Profile stream ${id}`);

    await page.goto(`${WEB_URL}/profile/${jake}?slow=${SLOW}`, {
      waitUntil: "commit",
    });

    await expect(page.locator(".user-info h4")).toHaveText(jake);
    const listSkeleton = page.getByTestId("article-list-skeleton").first();
    await expect(listSkeleton).toBeVisible();
    await expect(listSkeleton).toHaveAttribute("aria-busy", "true");

    await expect(listSkeleton).toBeHidden({ timeout: 5000 });
    await expect(
      page.locator(".article-preview").filter({ hasText: `Profile stream ${id}` }),
    ).toBeVisible();
  });

  test("Scenario 4: skeleton state has no critical/serious axe violations", async ({
    page,
  }) => {
    const id = uniq();
    const api = await FavoritesApi.newContext();
    await api.registerUser(`jake-${id}`);
    await api.createArticle(`Axe stream ${id}`);

    // Longer slow window so axe has time to run while the skeleton
    // is still mounted.
    await page.goto(`${WEB_URL}/?slow=3000`, { waitUntil: "commit" });
    await expect(page.getByTestId("tag-cloud-skeleton").first()).toBeVisible();
    await runAxe(page);
  });
});
