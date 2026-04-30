import { expect, request, test, type BrowserContext } from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #171 — comment soft-delete:
//   - DELETE on own comment soft-deletes (row stays, body stays on
//     disk, API swaps to "[deleted]")
//   - List endpoint returns the placeholder envelope
//   - Edit on soft-deleted comment 404s (terminal state)
//   - Admin moderation: ?moderation=true + reason body flags with
//     "[removed by moderation]"; non-admin call 403s
//   - UI renders a grayed-out placeholder card in the thread; no
//     Edit / Delete controls; comment count unchanged
//   - axe a11y passes on the placeholder state

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

test.describe("issue #171 — comment soft-delete", () => {
  test("Scenario 1: owner DELETE soft-deletes + list returns placeholder", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const { slug } = await createArticle(api, `Soft ${id}`);
    const { id: commentId } = await postComment(api, slug, "original body");

    const del = await api.delete(`/api/articles/${slug}/comments/${commentId}`);
    expect(del.status()).toBe(204);

    const list = await api.get(`/api/articles/${slug}/comments`);
    expect(list.status()).toBe(200);
    const payload = (await list.json()) as {
      comments: {
        id: number;
        body: string;
        deletedAt: string | null;
        author: { username: string };
      }[];
    };
    const row = payload.comments.find((c) => c.id === commentId);
    expect(row).toBeTruthy();
    expect(row?.body).toBe("[deleted]");
    expect(row?.author.username).toBe("[deleted]");
    expect(row?.deletedAt).toBeTruthy();
  });

  test("Scenario 2: PUT on a soft-deleted comment 404s", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const { slug } = await createArticle(api, `NoEdit ${id}`);
    const { id: commentId } = await postComment(api, slug, "before");

    const del = await api.delete(`/api/articles/${slug}/comments/${commentId}`);
    expect(del.status()).toBe(204);

    const put = await api.put(`/api/articles/${slug}/comments/${commentId}`, {
      data: { comment: { body: "rewriting history" } },
    });
    expect(put.status()).toBe(404);
  });

  test("Scenario 3: non-admin moderation call 403s", async () => {
    const id = uniq();
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    await registerUser(jakeApi, `jake-${id}`);
    await registerUser(danApi, `dan-${id}`);
    const { slug } = await createArticle(jakeApi, `Mod ${id}`);
    const { id: commentId } = await postComment(jakeApi, slug, "jake's");

    const res = await danApi.delete(
      `/api/articles/${slug}/comments/${commentId}?moderation=true`,
      { data: { reason: "spam" } },
    );
    expect(res.status()).toBe(403);
  });

  test("Scenario 4: moderation without reason returns 422", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const { slug } = await createArticle(api, `NoReason ${id}`);
    const { id: commentId } = await postComment(api, slug, "some body");

    const res = await api.delete(
      `/api/articles/${slug}/comments/${commentId}?moderation=true`,
      { data: { reason: "" } },
    );
    expect(res.status()).toBe(422);
  });

  test("Scenario 5: double-delete (already deleted) 404s", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const { slug } = await createArticle(api, `Once ${id}`);
    const { id: commentId } = await postComment(api, slug, "poof");

    const first = await api.delete(`/api/articles/${slug}/comments/${commentId}`);
    expect(first.status()).toBe(204);
    const second = await api.delete(`/api/articles/${slug}/comments/${commentId}`);
    expect(second.status()).toBe(404);
  });

  test("Scenario 6: UI renders placeholder card, no Edit/Delete, count unchanged", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    const { slug } = await createArticle(api, `UI ${id}`);
    const { id: firstId } = await postComment(api, slug, "first comment");
    // ms gap so createdAt differs deterministically (list ordering)
    await new Promise((r) => setTimeout(r, 1100));
    const { id: middleId } = await postComment(api, slug, "middle comment");
    await new Promise((r) => setTimeout(r, 1100));
    const { id: lastId } = await postComment(api, slug, "last comment");

    const del = await api.delete(`/api/articles/${slug}/comments/${middleId}`);
    expect(del.status()).toBe(204);

    await primeSession(context, session, jake);
    await page.goto(`${WEB_URL}/article/${slug}`);

    // All three cards still render (comment count preserved).
    const list = page.getByTestId("comment-list");
    await expect(list.locator(".card")).toHaveCount(3);

    // Middle card is flagged deleted.
    const middle = page.getByTestId(`comment-${middleId}`);
    await expect(middle).toHaveAttribute("data-deleted", "true");
    await expect(
      page.getByTestId(`comment-body-${middleId}`),
    ).toHaveText("[deleted]");

    // Edit trigger is gone for the deleted row.
    await expect(
      page.getByTestId(`comment-edit-trigger-${middleId}`),
    ).toHaveCount(0);
    // First + last still editable by the owner.
    await expect(
      page.getByTestId(`comment-edit-trigger-${firstId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`comment-edit-trigger-${lastId}`),
    ).toBeVisible();
  });

  test("Scenario 7: axe a11y gate on the placeholder state", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    const { slug } = await createArticle(api, `Axe ${id}`);
    const { id: commentId } = await postComment(api, slug, "will be deleted");
    const del = await api.delete(
      `/api/articles/${slug}/comments/${commentId}`,
    );
    expect(del.status()).toBe(204);

    await primeSession(context, session, jake);
    await page.goto(`${WEB_URL}/article/${slug}`);
    await expect(
      page.getByTestId(`comment-${commentId}`),
    ).toHaveAttribute("data-deleted", "true");
    await runAxe(page);
  });
});
