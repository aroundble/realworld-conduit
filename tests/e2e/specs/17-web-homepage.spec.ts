import { expect, request, test } from "@playwright/test";
import { runAxe } from "../axe-config";
import { HomePage } from "../page-objects/home";

// BDD coverage for issue #17 (rescoped by Audit E.1, 2026-04-29):
// static RSC homepage — banner, feed tabs, article preview cards,
// pagination, tag sidebar, empty state. The interactive favorite
// toggle lands in follow-up #56 so this spec asserts the non-
// interactive badge only.
//
// Every home DOM selector lives in HomePage
// (tests/e2e/page-objects/home.ts). #100 Phase 2 refactor.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// API-level helpers. Tests seed their users / articles via HTTP so the
// spec doesn't depend on the UI's register/login flow (covered by #16)
// — faster and avoids cross-spec coupling.
const apiContext = () => request.newContext({ baseURL: API_URL });

const registerUser = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  username: string,
): Promise<string> => {
  const res = await api.post("/api/users", {
    data: {
      user: { username, email: `${username}@jake.jake`, password: "jakejake" },
    },
  });
  expect(res.status()).toBe(201);
  const setCookie = res.headers()["set-cookie"] ?? "";
  // The API's Set-Cookie header is `conduit_session=<jwt>; Path=/; ...`.
  const match = setCookie.match(/conduit_session=([^;]+)/);
  if (!match) throw new Error("expected conduit_session cookie from register");
  return match[1];
};

const createArticle = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  title: string,
  tagList: string[] = [],
): Promise<string> => {
  const res = await api.post("/api/articles", {
    data: { article: { title, description: "d", body: "b", tagList } },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { article: { slug: string } };
  return body.article.slug;
};

test.describe("issue #17 — web homepage (RSC walking skeleton)", () => {
  test("Scenario 1: anonymous visitor sees banner + Global Feed tab only", async ({
    page,
  }) => {
    const home = new HomePage(page);
    const res = await home.goto(WEB_URL);
    expect(res?.status()).toBe(200);

    await home.expectBannerHeadline();
    await home.expectOnlyGlobalFeedVisible();
    await home.expectSidebarShowsPopularTags();
  });

  test("Scenario 2: authenticated viewer sees Your Feed tab as default", async ({
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

    await createArticle(jakeApi, `J1 home ${id}`);
    await createArticle(jakeApi, `J2 home ${id}`);
    // alice seeds a global-only article that should NOT appear in dan's feed.
    const alice = `alice-${id}`;
    const aliceApi = await apiContext();
    await registerUser(aliceApi, alice);
    await createArticle(aliceApi, `A1 home ${id}`);

    // dan follows jake via the API so "Your Feed" will include both of
    // jake's articles and none of alice's.
    const follow = await danApi.post(`/api/profiles/${jake}/follow`);
    expect(follow.status()).toBe(200);

    // Prime the browser with dan's session cookie so server-side fetch
    // is authed. Both conduit_session (credential) and conduit-user
    // (presentational) need to be present — the navbar reads the
    // latter, apiFetch forwards the former.
    const webOrigin = new URL(WEB_URL);
    await context.addCookies([
      {
        name: "conduit_session",
        value: danSession,
        domain: webOrigin.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "conduit-user",
        value: encodeURIComponent(JSON.stringify({ username: dan, image: null })),
        domain: webOrigin.hostname,
        path: "/",
        sameSite: "Lax",
      },
    ]);

    const home = new HomePage(page);
    const res = await home.gotoFeed(WEB_URL, "you");
    expect(res?.status()).toBe(200);

    await home.expectYourFeedActive();

    const titles = await home.allPreviewTitles();
    expect(titles).toContain(`J1 home ${id}`);
    expect(titles).toContain(`J2 home ${id}`);
    expect(titles).not.toContain(`A1 home ${id}`);
  });

  test("Scenario 3: clicking a tag pill pins the #tag tab and filters the list", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    await registerUser(api, jake);

    // Seed enough articles for this tag that it lands in the top-20
    // popular-tags sidebar deterministically even when other specs in
    // the same compose stack have seeded their own tags. 10 articles
    // is comfortably above the trailing edge of parallel seeds.
    const dragonsTag = `dragons-${id}`;
    const trainingTag = `training-${id}`;
    await createArticle(api, `Training regimen ${id}`, [trainingTag]);
    for (let i = 0; i < 10; i += 1) {
      await createArticle(api, `Dragon tales ${i} ${id}`, [dragonsTag]);
    }

    // Load home (anon — Global Feed), then click the seeded tag pill.
    const home = new HomePage(page);
    await home.goto(WEB_URL);
    await expect(home.sidebarTagPill(dragonsTag)).toBeVisible();
    await home.clickSidebarTag(dragonsTag);

    // URL reflects the filter.
    expect(page.url()).toContain(`tag=${encodeURIComponent(dragonsTag)}`);

    // Third tab `# <tag>` is pinned + active.
    await home.expectActiveTabText(`# ${dragonsTag}`);

    // List is filtered to dragons-tagged articles only — no training-
    // tagged article should appear anywhere on the page.
    const titles = await home.allPreviewTitles();
    for (const t of titles) {
      expect(t).not.toBe(`Training regimen ${id}`);
    }
    // At least one of this spec's dragons articles is visible.
    expect(titles.some((t) => t.startsWith("Dragon tales "))).toBe(true);
  });

  test("Scenario 4: article preview card renders envelope-driven fields including favorite button", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    await registerUser(api, jake);
    const tagA = `preview-a-${id}`;
    const tagB = `preview-b-${id}`;
    await createArticle(api, `Preview card ${id}`, [tagA, tagB]);

    const home = new HomePage(page);
    await home.gotoTag(WEB_URL, tagA);

    const preview = home.previewByTitle(`Preview card ${id}`);
    await expect(preview).toBeVisible();

    // Author username link present in the meta row, pointing at the
    // profile route for this user.
    const authorLink = preview.getByRole("link", { name: jake }).first();
    await expect(authorLink).toHaveAttribute("href", `/profile/${jake}`);

    // Title + description render.
    await expect(preview.locator("h1")).toHaveText(`Preview card ${id}`);
    await expect(preview.locator("p")).toHaveText("d");

    // Both seeded tags appear as tag pills.
    const tagTexts = await preview.locator(".tag-list li").allTextContents();
    expect(tagTexts.map((t) => t.trim())).toEqual(
      expect.arrayContaining([tagA, tagB]),
    );

    // Favorite button ships interactive in #56 (this spec used to
    // assert the placeholder non-interactive badge). Envelope-driven
    // state still renders: zero favorites, aria-pressed=false. The
    // FavoriteButton component POP from #99 owns this assertion in
    // spec 56; here we only check the envelope-driven render.
    const favBtn = preview.getByTestId("favorite-button");
    await expect(favBtn).toHaveAttribute("aria-pressed", "false");
    await expect(favBtn).toContainText("0");
  });

  test("Scenario 6: pagination via ?page=2 shows the next slice", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    await registerUser(api, jake);

    // Seed 25 articles under a unique tag so parallel suites don't
    // pollute the paginated view. 25 articles @ page size 20 = page 1
    // has 20 items, page 2 has 5.
    const pagTag = `pag-${id}`;
    for (let i = 0; i < 25; i += 1) {
      await createArticle(
        api,
        `P${i.toString().padStart(2, "0")} pag ${id}`,
        [pagTag],
      );
    }

    // Page 2 under the tag filter.
    const home = new HomePage(page);
    await home.gotoTag(WEB_URL, pagTag, 2);

    const titles = await home.allPreviewTitles();
    expect(titles.length).toBe(5);

    // Paginator renders two page links (1, 2) with 2 active.
    await home.expectPageCount(2);
    await home.expectActivePage(2);
  });

  test("Scenario 7: empty state message when no articles match", async ({
    page,
  }) => {
    // A tag no article can possibly have (seeded with timestamp + rand
    // suffix) produces a deterministic empty result.
    const missingTag = `no-such-tag-${uniq()}`;
    const home = new HomePage(page);
    await home.gotoTag(WEB_URL, missingTag);
    await home.expectEmptyList();
  });
});

test("axe a11y gate on homepage (#87)", async ({ page }) => {
  const home = new HomePage(page);
  await home.goto(WEB_URL);
  await runAxe(page);
});

// Mobile viewport coverage (#35 Phase 1). @mobile-tagged tests run
// under the `mobile` project in playwright.config.ts (Pixel 5
// emulation). Asserts the homepage reflows cleanly at narrow widths:
// single-column list, navbar collapses / brand still visible, tap
// targets meet the 44px floor.
test("homepage reflows on mobile viewport @mobile", async ({ page }) => {
  const jakeApi = await apiContext();
  await registerUser(jakeApi, `jake-${uniq()}`);
  await createArticle(jakeApi, `Mobile ${uniq()}`);
  const home = new HomePage(page);
  await home.goto(WEB_URL);

  // Navbar brand still visible at mobile viewport (375-412px wide).
  // Navbar is chrome, not home surface — selector stays inline here.
  const brand = page.locator(".navbar-brand");
  await expect(brand).toBeVisible();

  // First article preview renders within the mobile viewport width —
  // no horizontal scroll.
  const preview = home.previews.first();
  await expect(preview).toBeVisible();
  const box = await preview.boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error("viewport / bounding box unavailable");
  expect(box.width).toBeLessThanOrEqual(vp.width + 1);

  // Tap-target floor: the Global Feed tab link is at least 44×44
  // (WCAG 2.5.5 minimum target size for touch).
  const tabBox = await home.globalFeedTab.boundingBox();
  if (!tabBox) throw new Error("global feed tab box unavailable");
  expect(tabBox.height).toBeGreaterThanOrEqual(44);
});
