import {
  expect,
  test,
  type BrowserContext,
} from "@playwright/test";
import { runAxe } from "../axe-config";
import { FavoriteButton, FavoritesApi } from "../page-objects/favorite";

// BDD coverage for issue #56: interactive favorite toggle on the
// homepage ArticlePreview card. Four scenarios from the issue body.
//
// #99 Phase 2 refactor: API seeds go through `FavoritesApi`; the
// FavoriteButton on each preview card is driven by the
// `FavoriteButton` component POP (resolved by slug via
// `FavoriteButton.inCard(page, slug)`).

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const primeSession = async (
  context: BrowserContext,
  session: string,
  username: string,
): Promise<void> => {
  const webOrigin = new URL(WEB_URL);
  await context.addCookies([
    {
      name: "conduit_session",
      value: session,
      domain: webOrigin.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "conduit-user",
      value: encodeURIComponent(JSON.stringify({ username, image: null })),
      domain: webOrigin.hostname,
      path: "/",
      sameSite: "Lax",
    },
  ]);
};

test.describe("issue #56 — homepage favorite toggle", () => {
  // Cold-start warmup (#89). A fresh `docker compose up --build` leaves
  // Next's first-compile window open for a few seconds after the web
  // container reports healthy — the useOptimistic + router.refresh()
  // dance in FavoriteButton can land its optimistic flip against a
  // not-yet-warmed bundle and get overwritten when the refresh's
  // freshly-compiled props arrive. One goto + networkidle here closes
  // that window before Scenario 1 runs, without changing runtime
  // behaviour.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
    } finally {
      await page.close();
    }
  });

  test("Scenario 1: authed favorite on a preview card — optimistic flip + persists", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await jakeApi.registerUser(jake);
    const danSession = await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Fav1 ${id}`);
    await primeSession(context, danSession, dan);

    // The favorite POST runs server-side (Next action → internal
    // api:3001), so it isn't visible to the browser's network layer.
    // Assert the user-visible outcomes instead: optimistic flip, then
    // persisted state after reload + independent API read.

    await page.goto(`${WEB_URL}/`);
    const btn = FavoriteButton.inCard(page, slug);
    await expect(btn.locator).toBeVisible();

    await btn.expectPressed(false);
    await btn.expectCount(0);
    await btn.click();

    // Optimistic flip lands immediately; the final committed value
    // should still be 1 after the client's router.refresh() cycle.
    await btn.expectPressed(true);
    await btn.expectCount(1);
    // Wait for the server action's transition to complete (aria-busy
    // clears when router.refresh() has returned + props landed). The
    // earlier aria-pressed check satisfies the optimistic path; this
    // guarantees the DB write committed before the independent-fetch
    // persistence check below — closes the cold-start race in #89.
    await btn.expectTransitionSettled();

    // Persistence: independent API fetch confirms the DB write landed.
    const article = await danApi.readBySlug(slug);
    expect(article.favorited).toBe(true);
    expect(article.favoritesCount).toBe(1);
  });

  test("Scenario 2: unfavorite on a preview card — optimistic flip + persists", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await jakeApi.registerUser(jake);
    const danSession = await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Fav2 ${id}`);
    // Seed: dan favorites via the API so the UI starts with favorited=true.
    await danApi.favorite(slug);
    await primeSession(context, danSession, dan);

    await page.goto(`${WEB_URL}/`);
    const btn = FavoriteButton.inCard(page, slug);
    await btn.expectPressed(true);
    await btn.expectCount(1);
    await btn.click();

    await btn.expectPressed(false);
    await btn.expectCount(0);
    // Wait for the transition to commit before the independent-fetch
    // persistence check — see Scenario 1 note and #89.
    await btn.expectTransitionSettled();

    const article = await danApi.readBySlug(slug);
    expect(article.favorited).toBe(false);
    expect(article.favoritesCount).toBe(0);
  });

  test("Scenario 3: server rejects the toggle — UI reverts + error indication", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await jakeApi.registerUser(jake);
    const danSession = await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Fav3 ${id}`);
    await primeSession(context, danSession, dan);

    // Induce a 404 from the server action by deleting the article
    // after the page render but before the click. favoriteArticle
    // throws when the API responds non-2xx, which surfaces as
    // data-errored + optimistic revert via useOptimistic.
    await page.goto(`${WEB_URL}/`);
    const btn = FavoriteButton.inCard(page, slug);
    await btn.expectPressed(false);

    await jakeApi.deleteArticle(slug);

    await btn.click();

    // Within the 1s AC window, the button returns to favorited=false
    // and flags the error via data-errored.
    await btn.expectErrored();
    await btn.expectPressed(false);
    await btn.expectCount(0);
  });

  test("Scenario 4: anonymous click navigates to /login?next=... and fires no POST", async ({
    page,
  }) => {
    const id = uniq();
    const jakeApi = await FavoritesApi.newContext();
    await jakeApi.registerUser(`jake-${id}`);
    const slug = await jakeApi.createArticle(`Fav4 ${id}`);

    // Assert no favorite POST is ever attempted.
    let favPostSeen = false;
    page.on("request", (req) => {
      if (
        req.url().endsWith(`/api/articles/${slug}/favorite`) &&
        req.method() === "POST"
      ) {
        favPostSeen = true;
      }
    });

    await page.goto(`${WEB_URL}/`);
    const btn = FavoriteButton.inCard(page, slug);
    await expect(btn.locator).toBeVisible();
    await btn.click();

    const expectedNext = `/article/${encodeURIComponent(slug)}`;
    await page.waitForURL(
      (url) =>
        url.pathname === "/login" &&
        url.searchParams.get("next") === expectedNext,
    );
    expect(favPostSeen).toBe(false);
  });
});

test("axe a11y gate on homepage with articles (#87)", async ({ page }) => {
  const id = uniq();
  const api = await FavoritesApi.newContext();
  await api.registerUser(`jake-${id}`);
  await api.createArticle(`Axe ${id}`);
  await page.goto(`${WEB_URL}/`);
  await runAxe(page);
});
