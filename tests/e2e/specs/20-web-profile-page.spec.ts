import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";
import { runAxe } from "../axe-config";
import { ProfilePage } from "../page-objects/profile";

// BDD coverage for issue #20: profile page.
// Five AC scenarios.
//
// Every DOM selector for /profile/:user lives in ProfilePage
// (tests/e2e/page-objects/profile.ts). #101 Phase 2 refactor.
//
// Fixture migration per #101 AC: the authedContext fixture provides
// a single worker-scoped user. Scenarios in this spec mostly need
// either two users (S1 + S2) or they're anon-only (S4). Scenario 3
// (self-profile of authed) and Scenario 5 (authed empty favorited)
// both need the authed user to be the profile *owner* — since the
// fixture user's username isn't known until runtime, inline
// priming keeps the assertions readable. Future refactors can
// migrate these once ProfilePage exposes a "visit-my-profile"
// helper that reads `authedUser.username`.

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

    const profile = new ProfilePage(page);
    await profile.goto(WEB_URL, jake);

    // Banner: username + default avatar, no bio.
    await profile.expectUsername(jake);

    // Tabs visible, "My Articles" selected by default.
    await profile.expectTabActive("my");

    // Filter titles to this spec's id so parallel seeds don't leak in.
    const authoredTitles = await profile.titlesEndingWith(` ${id}`);
    expect(authoredTitles.sort()).toEqual(
      [`Jake 0 ${id}`, `Jake 1 ${id}`, `Jake 2 ${id}`].sort(),
    );

    // Switch to favorited tab.
    await profile.clickFavoritedTab();
    await profile.expectTabActive("favorited");

    const favTitles = await profile.titlesEndingWith(` ${id}`);
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

    const profile = new ProfilePage(page);
    await profile.goto(WEB_URL, jake);
    await profile.expectFollowButtonVisible(jake);
    await profile.follow(jake);

    // Persist on reload.
    await page.reload();
    await profile.expectFollowing(jake);
  });

  test("Scenario 3: self profile shows Edit Profile Settings link, not a Follow button", async ({
    page,
    context,
  }) => {
    const jake = `jake-${uniq()}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const profile = new ProfilePage(page);
    await profile.goto(WEB_URL, jake);
    await profile.expectEditProfileLink();
    await profile.expectNoFollowButton();
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
    const jake = `jake-${uniq()}`;
    const jakeApi = await apiContext();
    await registerUser(jakeApi, jake);
    // jake exists but has favorited no articles.

    const profile = new ProfilePage(page);
    await profile.gotoFavoritedTab(WEB_URL, jake);
    // Scope to the article-preview region to catch the empty-state
    // copy rendered by ArticleList when the list is empty.
    await profile.expectEmptyList();
  });
});

test("axe a11y gate on profile page (#87)", async ({ page }) => {
  const jake = `jake-${uniq()}`;
  const api = await apiContext();
  await registerUser(api, jake);
  await page.goto(`${WEB_URL}/profile/${jake}`);
  await runAxe(page);
});
