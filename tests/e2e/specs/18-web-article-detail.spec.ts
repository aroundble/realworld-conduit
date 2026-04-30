import { expect, request, test, type BrowserContext } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #18: article detail page with markdown,
// comments, follow/favorite, author delete, and graceful 404.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Each test uses its own ApiRequestContext so we can set the
// per-user auth cookie without bleed between scenarios.
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

type CreateArticleOpts = { title?: string; body?: string; tagList?: string[] };
const createArticle = async (
  api: ApiCtx,
  opts: CreateArticleOpts = {},
): Promise<{ slug: string; title: string }> => {
  const title = opts.title ?? `Title ${uniq()}`;
  const res = await api.post("/api/articles", {
    data: {
      article: {
        title,
        description: "d",
        body: opts.body ?? "body",
        tagList: opts.tagList ?? [],
      },
    },
  });
  expect(res.status()).toBe(201);
  const payload = (await res.json()) as { article: { slug: string } };
  return { slug: payload.article.slug, title };
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

test.describe("issue #18 — article detail page", () => {
  test("Scenario 1: anonymous view renders article + comments, compose box gated", async ({
    page,
  }) => {
    const jakeApi = await apiContext();
    await registerUser(jakeApi, `jake-${uniq()}`);
    const { slug, title } = await createArticle(jakeApi, {
      title: `Anon View ${uniq()}`,
      body: "Hello body.",
      tagList: ["anon"],
    });

    const res = await page.goto(`${WEB_URL}/article/${slug}`);
    expect(res?.status()).toBe(200);

    await expect(page.locator(".banner h1")).toHaveText(title);
    await expect(page.getByTestId("article-body")).toContainText("Hello body.");
    await expect(page.locator(".tag-list")).toContainText("anon");

    // Compose box is replaced with a sign-in/register prompt.
    await expect(page.locator('[aria-label="Comments"]')).toContainText(
      "add comments",
    );
    await expect(
      page.locator('textarea[name="body"]'),
    ).toHaveCount(0);
    // Follow + favorite buttons link to login rather than posting.
    const banner = page.locator(".banner");
    await expect(banner.getByRole("link", { name: /Follow/ })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(
      banner.getByRole("link", { name: /Favorite Article/ }),
    ).toHaveAttribute("href", "/login");
  });

  test("Scenario 2: authed follow + favorite toggle persist through refresh", async ({
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
    const { slug } = await createArticle(jakeApi, { title: `Follow ${id}` });
    await primeSession(context, danSession, dan);

    await page.goto(`${WEB_URL}/article/${slug}`);

    // The page renders ArticleMeta twice (banner + footer) per the
    // RealWorld UI spec, so there are two copies of each button —
    // scope to the banner's first instance when clicking.
    const followBtn = page
      .getByRole("button", { name: `Follow ${jake}` })
      .first();
    await expect(followBtn).toBeVisible();
    await followBtn.click();
    await expect(
      page.getByRole("button", { name: `Unfollow ${jake}` }).first(),
    ).toBeVisible();

    const favBtn = page
      .getByRole("button", { name: /Favorite Article \(0\)/ })
      .first();
    await favBtn.click();
    await expect(
      page.getByRole("button", { name: /Unfavorite Article \(1\)/ }).first(),
    ).toBeVisible();

    // Refresh: persisted server state should render the same labels.
    await page.reload();
    await expect(
      page.getByRole("button", { name: `Unfollow ${jake}` }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Unfavorite Article \(1\)/ }).first(),
    ).toBeVisible();
  });

  test("Scenario 3: markdown is rendered and sanitised", async ({ page }) => {
    const jakeApi = await apiContext();
    await registerUser(jakeApi, `jake-${uniq()}`);
    const body = "# Heading\n\n**bold** text and a <script>alert(1)</script>";
    const { slug } = await createArticle(jakeApi, {
      title: `Markdown ${uniq()}`,
      body,
    });

    await page.goto(`${WEB_URL}/article/${slug}`);

    const bodyRegion = page.getByTestId("article-body");
    await expect(bodyRegion.locator("h1")).toHaveText("Heading");
    await expect(bodyRegion.locator("strong")).toHaveText("bold");
    // rehype-sanitize must strip <script>. Scoped to the body region so
    // the app's own script tags (Next runtime) are not counted.
    await expect(bodyRegion.locator("script")).toHaveCount(0);
    const html = await bodyRegion.innerHTML();
    expect(html).not.toContain("<script>");
  });

  test("Scenario 4: author sees Edit + Delete, delete redirects home", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const jakeSession = await registerUser(jakeApi, jake);
    const { slug } = await createArticle(jakeApi, { title: `Own ${id}` });
    await primeSession(context, jakeSession, jake);

    await page.goto(`${WEB_URL}/article/${slug}`);

    await expect(
      page.getByRole("link", { name: /Edit Article/ }).first(),
    ).toHaveAttribute("href", `/editor/${slug}`);
    // Follow/favorite must NOT appear on my own article.
    await expect(
      page.getByRole("button", { name: /Follow/ }),
    ).toHaveCount(0);

    // Auto-confirm the delete dialog, then click.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Delete Article/ }).first().click();

    await page.waitForURL(`${WEB_URL}/`);
    expect(page.url().replace(/\/$/, "")).toBe(WEB_URL);

    // The article is gone: direct revisit yields 404.
    const revisit = await page.goto(`${WEB_URL}/article/${slug}`);
    expect(revisit?.status()).toBe(404);
  });

  test("Scenario 5: existing comments list renders newest-first", async ({
    page,
  }) => {
    const id = uniq();
    const jakeApi = await apiContext();
    const jake = `jake-${id}`;
    await registerUser(jakeApi, jake);
    const { slug } = await createArticle(jakeApi, { title: `Comments ${id}` });

    const first = await jakeApi.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: `first ${id}` } },
    });
    expect(first.status()).toBe(201);
    // Tiny gap so the createdAt timestamps differ deterministically.
    await new Promise((r) => setTimeout(r, 1100));
    const second = await jakeApi.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: `second ${id}` } },
    });
    expect(second.status()).toBe(201);

    await page.goto(`${WEB_URL}/article/${slug}`);
    const bodies = await page
      .getByTestId("comment-list")
      .locator(".card-text")
      .allTextContents();
    expect(bodies.length).toBe(2);
    expect(bodies[0]).toContain(`second ${id}`);
    expect(bodies[1]).toContain(`first ${id}`);
  });

  test("Scenario 6: authenticated user posts a comment, it appears without full reload", async ({
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
    const { slug } = await createArticle(jakeApi, { title: `Post ${id}` });
    await primeSession(context, danSession, dan);

    await page.goto(`${WEB_URL}/article/${slug}`);
    await page
      .locator('textarea[name="body"]')
      .fill(`a new comment ${id}`);
    await page.getByRole("button", { name: "Post Comment" }).click();

    await expect(
      page.getByTestId("comment-list").locator(".card-text").first(),
    ).toContainText(`a new comment ${id}`);
  });

  test("Scenario 7: comment author sees delete only on their own rows", async ({
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
    const { slug } = await createArticle(jakeApi, { title: `Trash ${id}` });

    // Jake posts one comment, dan posts another.
    const jRes = await jakeApi.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: `from-jake ${id}` } },
    });
    expect(jRes.status()).toBe(201);
    const dRes = await danApi.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: `from-dan ${id}` } },
    });
    expect(dRes.status()).toBe(201);
    const danCommentId = ((await dRes.json()) as { comment: { id: number } })
      .comment.id;

    await primeSession(context, danSession, dan);
    await page.goto(`${WEB_URL}/article/${slug}`);

    // Exactly one delete button visible — on dan's own row.
    const deleteButtons = page.getByRole("button", { name: "Delete comment" });
    await expect(deleteButtons).toHaveCount(1);

    await deleteButtons.click();
    // Soft-delete (#171): the row stays in the thread but flips
    // to the "[deleted]" placeholder. The Delete button is gone
    // (it was scoped to owned, non-deleted rows).
    await expect(
      page.getByTestId(`comment-${danCommentId}`),
    ).toHaveAttribute("data-deleted", "true");
    await expect(
      page.getByRole("button", { name: "Delete comment" }),
    ).toHaveCount(0);
    // Jake's comment still there.
    await expect(page.getByTestId("comment-list")).toContainText(
      `from-jake ${id}`,
    );
  });

  test("Scenario 8: non-existent slug returns 404 with a helpful message", async ({
    page,
  }) => {
    const res = await page.goto(`${WEB_URL}/article/no-such-slug-${uniq()}`);
    expect(res?.status()).toBe(404);
    await expect(page.locator("body")).toContainText("Article not found");
  });
});

test("axe a11y gate on article detail (#87)", async ({ page }) => {
  const jakeApi = await apiContext();
  await registerUser(jakeApi, `jake-${uniq()}`);
  const { slug } = await createArticle(jakeApi, {
    title: `Axe ${uniq()}`,
    body: "Hello body.",
  });
  await page.goto(`${WEB_URL}/article/${slug}`);
  await runAxe(page);
});
