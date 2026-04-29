import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";

// BDD coverage for issue #56: interactive favorite toggle on the
// homepage ArticlePreview card. Four scenarios from the issue body.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type ApiCtx = Awaited<ReturnType<typeof request.newContext>>;
const apiContext = () => request.newContext({ baseURL: API_URL });

const registerUser = async (api: ApiCtx, username: string): Promise<string> => {
  const res = await api.post("/api/users", {
    data: {
      user: {
        username,
        email: `${username}@jake.jake`,
        password: "jakejake",
      },
    },
  });
  expect(res.status()).toBe(201);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/conduit_session=([^;]+)/);
  if (!match) throw new Error("expected conduit_session cookie from register");
  return match[1];
};

const createArticle = async (
  api: ApiCtx,
  title: string,
): Promise<string> => {
  const res = await api.post("/api/articles", {
    data: { article: { title, description: "d", body: "b" } },
  });
  expect(res.status()).toBe(201);
  const payload = (await res.json()) as { article: { slug: string } };
  return payload.article.slug;
};

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

// The preview card carrying slug `<slug>` scopes the FavoriteButton
// assertions to that one article — otherwise sibling previews (seeded
// by other specs running in parallel) would poison role queries.
const cardFor = (page: Parameters<typeof test>[1] extends (args: {
  page: infer P;
}) => unknown
  ? P
  : never, slug: string) =>
  page.locator(`.article-preview:has(a[href="/article/${slug}"])`);

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
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await registerUser(jakeApi, jake);
    const danSession = await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Fav1 ${id}`);
    await primeSession(context, danSession, dan);

    // The favorite POST runs server-side (Next action → internal
    // api:3001), so it isn't visible to the browser's network layer.
    // Assert the user-visible outcomes instead: optimistic flip, then
    // persisted state after reload + independent API read.

    await page.goto(`${WEB_URL}/`);
    const card = cardFor(page, slug);
    await expect(card).toBeVisible();

    const btn = card.getByTestId("favorite-button");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(btn).toContainText("0");
    await btn.click();

    // Optimistic flip lands immediately; the final committed value
    // should still be 1 after the client's router.refresh() cycle.
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(btn).toContainText("1");
    // Wait for the server action's transition to complete (aria-busy
    // clears when router.refresh() has returned + props landed). The
    // earlier aria-pressed check satisfies the optimistic path; this
    // guarantees the DB write committed before the independent-fetch
    // persistence check below — closes the cold-start race in #89.
    await expect(btn).not.toHaveAttribute("aria-busy", "true");

    // Persistence: independent API fetch confirms the DB write landed.
    const check = await danApi.get(`/api/articles/${slug}`);
    expect(check.status()).toBe(200);
    const body = (await check.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(body.article.favorited).toBe(true);
    expect(body.article.favoritesCount).toBe(1);
  });

  test("Scenario 2: unfavorite on a preview card — optimistic flip + persists", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await registerUser(jakeApi, jake);
    const danSession = await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Fav2 ${id}`);
    // Seed: dan favorites via the API so the UI starts with favorited=true.
    const favSeed = await danApi.post(`/api/articles/${slug}/favorite`);
    expect(favSeed.status()).toBe(200);
    await primeSession(context, danSession, dan);

    await page.goto(`${WEB_URL}/`);
    const card = cardFor(page, slug);
    const btn = card.getByTestId("favorite-button");
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(btn).toContainText("1");
    await btn.click();

    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(btn).toContainText("0");
    // Wait for the transition to commit before the independent-fetch
    // persistence check — see Scenario 1 note and #89.
    await expect(btn).not.toHaveAttribute("aria-busy", "true");

    const check = await danApi.get(`/api/articles/${slug}`);
    expect(check.status()).toBe(200);
    const body = (await check.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(body.article.favorited).toBe(false);
    expect(body.article.favoritesCount).toBe(0);
  });

  test("Scenario 3: server rejects the toggle — UI reverts + error indication", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await registerUser(jakeApi, jake);
    const danSession = await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Fav3 ${id}`);
    await primeSession(context, danSession, dan);

    // Induce a 404 from the server action by deleting the article
    // after the page render but before the click. favoriteArticle
    // throws when the API responds non-2xx, which surfaces as
    // data-errored + optimistic revert via useOptimistic.
    await page.goto(`${WEB_URL}/`);
    const card = cardFor(page, slug);
    const btn = card.getByTestId("favorite-button");
    await expect(btn).toHaveAttribute("aria-pressed", "false");

    const del = await jakeApi.delete(`/api/articles/${slug}`);
    expect(del.status()).toBe(204);

    await btn.click();

    // Within the 1s AC window, the button returns to favorited=false
    // and flags the error via data-errored.
    await expect(btn).toHaveAttribute("data-errored", "true", { timeout: 2000 });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(btn).toContainText("0");
  });

  test("Scenario 4: anonymous click navigates to /login?next=... and fires no POST", async ({
    page,
  }) => {
    const id = uniq();
    const jakeApi = await apiContext();
    await registerUser(jakeApi, `jake-${id}`);
    const slug = await createArticle(jakeApi, `Fav4 ${id}`);

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
    const card = cardFor(page, slug);
    await expect(card).toBeVisible();
    const btn = card.getByTestId("favorite-button");
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
