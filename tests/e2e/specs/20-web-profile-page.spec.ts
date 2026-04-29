import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";

// BDD coverage for issue #20: profile page.
// Five AC scenarios.

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
  return ((await res.json()) as { article: { slug: string } }).article.slug;
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

test.describe("issue #20 — profile page", () => {
  test("Scenario 1: anonymous view — banner, tabs, authored articles list, tab switch to favorited", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);

    // jake authors 3 articles; dan's article (not jake's) is the one
    // jake favorites so it shows up on the Favorited tab.
    for (let i = 0; i < 3; i++) {
      await createArticle(jakeApi, `Jake ${i} ${id}`);
    }
    const danSlug = await createArticle(danApi, `Dan A ${id}`);
    const fav = await jakeApi.post(`/api/articles/${danSlug}/favorite`);
    expect(fav.status()).toBe(200);

    await page.goto(`${WEB_URL}/profile/${jake}`);

    // Banner: username + default avatar, no bio.
    await expect(page.locator(".user-info h4")).toHaveText(jake);

    // Tabs visible, "My Articles" selected by default.
    const myTab = page.getByRole("link", { name: "My Articles" });
    const favTab = page.getByRole("link", { name: "Favorited Articles" });
    await expect(myTab).toHaveClass(/active/);
    await expect(favTab).not.toHaveClass(/active/);

    // Filter titles to this spec's id so parallel seeds don't leak in.
    const authoredTitles = (
      await page.locator(".article-preview h1").allTextContents()
    ).filter((t) => t.endsWith(` ${id}`));
    expect(authoredTitles.sort()).toEqual(
      [`Jake 0 ${id}`, `Jake 1 ${id}`, `Jake 2 ${id}`].sort(),
    );

    // Switch to favorited tab.
    await favTab.click();
    await page.waitForURL(/\/profile\/.+\?tab=favorited/);
    await expect(favTab).toHaveClass(/active/);

    const favTitles = (
      await page.locator(".article-preview h1").allTextContents()
    ).filter((t) => t.endsWith(` ${id}`));
    expect(favTitles).toEqual([`Dan A ${id}`]);
  });

  test("Scenario 2: authed non-self sees Follow button, click toggles + persists on reload", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    await registerUser(jakeApi, jake);
    const danSession = await registerUser(danApi, dan);
    await primeSession(context, danSession, dan);

    await page.goto(`${WEB_URL}/profile/${jake}`);
    const follow = page.getByRole("button", { name: `Follow ${jake}` });
    await expect(follow).toBeVisible();
    await follow.click();

    await expect(
      page.getByRole("button", { name: `Unfollow ${jake}` }),
    ).toBeVisible();

    // Persist on reload.
    await page.reload();
    await expect(
      page.getByRole("button", { name: `Unfollow ${jake}` }),
    ).toBeVisible();
  });

  test("Scenario 3: self profile shows Edit Profile Settings link, not a Follow button", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/profile/${jake}`);

    const editLink = page.getByRole("link", { name: /Edit Profile Settings/ });
    await expect(editLink).toHaveAttribute("href", "/settings");
    await expect(
      page.getByRole("button", { name: /^Follow|^Unfollow/ }),
    ).toHaveCount(0);
  });

  test("Scenario 4: unknown user returns 404 with a helpful page", async ({
    page,
  }) => {
    const res = await page.goto(`${WEB_URL}/profile/nobody-${uniq()}`);
    expect(res?.status()).toBe(404);
    await expect(page.locator("body")).toContainText("User not found");
  });

  test("Scenario 5: empty favorited tab shows empty-state", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    await registerUser(jakeApi, jake);
    // jake exists but has favorited no articles.

    await page.goto(`${WEB_URL}/profile/${jake}?tab=favorited`);

    // Scope to the article-preview region to catch the empty-state
    // copy rendered by ArticleList when the list is empty.
    await expect(page.locator(".article-preview")).toContainText(
      "No articles are here... yet.",
    );
  });
});
