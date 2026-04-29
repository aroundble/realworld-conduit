import { expect, request, test, type BrowserContext } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #159 — comment edit: PUT endpoint,
// owner-gated inline edit UI, (edited) badge, 403 + Cancel paths.

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
): Promise<{ slug: string }> => {
  const res = await api.post("/api/articles", {
    data: {
      article: { title, description: "d", body: "body", tagList: [] },
    },
  });
  expect(res.status()).toBe(201);
  const payload = (await res.json()) as { article: { slug: string } };
  return { slug: payload.article.slug };
};

const postComment = async (
  api: ApiCtx,
  slug: string,
  body: string,
): Promise<{ id: number }> => {
  const res = await api.post(`/api/articles/${slug}/comments`, {
    data: { comment: { body } },
  });
  expect(res.status()).toBe(201);
  const payload = (await res.json()) as { comment: { id: number } };
  return { id: payload.comment.id };
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

test.describe("issue #159 — comment edit", () => {
  test("Scenario 1: PUT endpoint updates body + bumps updatedAt", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const { slug } = await createArticle(api, `API Edit ${id}`);
    const { id: commentId } = await postComment(api, slug, "original body");

    const putRes = await api.put(
      `/api/articles/${slug}/comments/${commentId}`,
      { data: { comment: { body: "updated body" } } },
    );
    expect(putRes.status()).toBe(200);
    const payload = (await putRes.json()) as {
      comment: { body: string; createdAt: string; updatedAt: string };
    };
    expect(payload.comment.body).toBe("updated body");
    // updatedAt should be strictly after createdAt.
    expect(Date.parse(payload.comment.updatedAt)).toBeGreaterThan(
      Date.parse(payload.comment.createdAt),
    );

    // Subsequent GET reflects the new body.
    const getRes = await api.get(`/api/articles/${slug}/comments`);
    const list = (await getRes.json()) as {
      comments: { id: number; body: string }[];
    };
    expect(list.comments.find((c) => c.id === commentId)?.body).toBe(
      "updated body",
    );
  });

  test("Scenario 2: non-owner PUT gets 403", async () => {
    const id = uniq();
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    await registerUser(jakeApi, `jake-${id}`);
    await registerUser(danApi, `dan-${id}`);
    const { slug } = await createArticle(jakeApi, `Authz ${id}`);
    const { id: commentId } = await postComment(jakeApi, slug, "jake's post");

    const res = await danApi.put(
      `/api/articles/${slug}/comments/${commentId}`,
      { data: { comment: { body: "hijack" } } },
    );
    expect(res.status()).toBe(403);
    const payload = (await res.json()) as { errors: Record<string, string[]> };
    expect(payload.errors).toHaveProperty("comment");
  });

  test("Scenario 3: empty body yields 422", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const { slug } = await createArticle(api, `Validate ${id}`);
    const { id: commentId } = await postComment(api, slug, "text");

    const res = await api.put(`/api/articles/${slug}/comments/${commentId}`, {
      data: { comment: { body: "" } },
    });
    expect(res.status()).toBe(422);
  });

  test("Scenario 4: owner sees Edit button + can inline-edit + save", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    const { slug } = await createArticle(api, `Inline ${id}`);
    const { id: commentId } = await postComment(api, slug, "before edit");
    await primeSession(context, session, jake);

    // Wait past the 5s (edited) tolerance window so the badge
    // surfaces on the next render. The tolerance exists so DB
    // createdAt vs service-set updatedAt (a few ms apart on
    // initial insert) does not spuriously flag every new comment
    // as "edited". Real users edit minutes / hours later; e2e has
    // to wait out the window explicitly.
    await new Promise((r) => setTimeout(r, 5500));

    await page.goto(`${WEB_URL}/article/${slug}`);
    const trigger = page.getByTestId(`comment-edit-trigger-${commentId}`);
    await expect(trigger).toBeVisible();
    await trigger.click();

    const textarea = page.getByTestId(`comment-edit-textarea-${commentId}`);
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue("before edit");
    await textarea.fill("after edit");

    await page.getByTestId(`comment-edit-save-${commentId}`).click();

    await expect(
      page.getByTestId(`comment-body-${commentId}`),
    ).toHaveText("after edit");
    // (edited) badge appears once the server round-trip settles
    // (router.refresh pulls the bumped updatedAt).
    await expect(
      page.getByTestId(`comment-edited-badge-${commentId}`),
    ).toBeVisible();
  });

  test("Scenario 5: Cancel discards the edit and reverts the body", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    const { slug } = await createArticle(api, `Cancel ${id}`);
    const { id: commentId } = await postComment(api, slug, "keep me");
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/article/${slug}`);
    await page.getByTestId(`comment-edit-trigger-${commentId}`).click();

    const textarea = page.getByTestId(`comment-edit-textarea-${commentId}`);
    await textarea.fill("about to discard this");
    await page.getByTestId(`comment-edit-cancel-${commentId}`).click();

    // Body is unchanged + the trigger is back (textarea unmounted).
    await expect(
      page.getByTestId(`comment-body-${commentId}`),
    ).toHaveText("keep me");
    await expect(textarea).toHaveCount(0);
    // No edited badge — the server was never called.
    await expect(
      page.getByTestId(`comment-edited-badge-${commentId}`),
    ).toHaveCount(0);
  });

  test("Scenario 6: non-owner does NOT see the Edit trigger", async ({
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
    const { slug } = await createArticle(jakeApi, `ReadOnly ${id}`);
    const { id: commentId } = await postComment(jakeApi, slug, "jake only");
    await primeSession(context, danSession, dan);

    await page.goto(`${WEB_URL}/article/${slug}`);
    await expect(
      page.getByTestId(`comment-edit-trigger-${commentId}`),
    ).toHaveCount(0);
    // The comment body still renders (read-only shell for non-owners).
    await expect(page.getByTestId("comment-list")).toContainText("jake only");
  });

  test("Scenario 7: saving an empty body surfaces an inline error, no close", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    const { slug } = await createArticle(api, `Empty ${id}`);
    const { id: commentId } = await postComment(api, slug, "original");
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/article/${slug}`);
    await page.getByTestId(`comment-edit-trigger-${commentId}`).click();
    await page
      .getByTestId(`comment-edit-textarea-${commentId}`)
      .fill("   ");
    await page.getByTestId(`comment-edit-save-${commentId}`).click();

    await expect(
      page.getByTestId(`comment-edit-errors-${commentId}`),
    ).toBeVisible();
    // Editor stays open so the user can fix the input.
    await expect(
      page.getByTestId(`comment-edit-textarea-${commentId}`),
    ).toBeVisible();
  });

  test("Scenario 8: axe a11y gate with the inline editor open", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    const { slug } = await createArticle(api, `Axe ${id}`);
    const { id: commentId } = await postComment(api, slug, "axe body");
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/article/${slug}`);
    await page.getByTestId(`comment-edit-trigger-${commentId}`).click();
    await expect(
      page.getByTestId(`comment-edit-textarea-${commentId}`),
    ).toBeVisible();
    await runAxe(page);
  });
});
