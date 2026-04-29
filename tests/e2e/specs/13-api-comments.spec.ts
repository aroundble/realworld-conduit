import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #13: comments CRUD on articles.
// Seven AC scenarios. Each test seeds its own jake / dan / article so
// suites are independent of other specs running against the same
// compose stack.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const registerUser = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  username: string,
) => {
  const res = await api.post("/api/users", {
    data: { user: { username, email: `${username}@jake.jake`, password: "jakejake" } },
  });
  expect(res.status()).toBe(201);
};

const createArticle = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  title: string,
): Promise<string> => {
  const res = await api.post("/api/articles", {
    data: { article: { title, description: "d", body: "b" } },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { article: { slug: string } };
  return body.article.slug;
};

const addComment = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  slug: string,
  body: string,
): Promise<number> => {
  const res = await api.post(`/api/articles/${slug}/comments`, {
    data: { comment: { body } },
  });
  expect(res.status()).toBe(201);
  const payload = (await res.json()) as { comment: { id: number } };
  return payload.comment.id;
};

test.describe("issue #13 — API comments CRUD", () => {
  test("Scenario 1: anonymous list — 200, shape + order", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `List ${id}`);

    await addComment(jakeApi, slug, "jake's first");
    // A hair of delay so createdAt values are strictly increasing at
    // the ms granularity postgres exposes.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await addComment(danApi, slug, "dan replies");

    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get(`/api/articles/${slug}/comments`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      comments: Array<{
        id: number;
        createdAt: string;
        updatedAt: string;
        body: string;
        author: {
          username: string;
          bio: string | null;
          image: string | null;
          following: boolean;
        };
      }>;
    };
    expect(body.comments.length).toBe(2);
    // Descending by createdAt — dan's "dan replies" (newer) comes first.
    expect(body.comments[0].author.username).toBe(dan);
    expect(body.comments[1].author.username).toBe(jake);
    expect(body.comments[0].body).toBe("dan replies");
    expect(body.comments[1].body).toBe("jake's first");
    expect(Date.parse(body.comments[0].createdAt)).toBeGreaterThanOrEqual(
      Date.parse(body.comments[1].createdAt),
    );
    // Envelope shape: author is a Profile with viewer-relative flag.
    expect(body.comments[0].author.following).toBe(false);
    // Fresh users have bio = null and image = null (our register path
    // stores the defaults as nulls, matching #4's established shape).
    expect(body.comments[0].author.bio).toBeNull();
    expect(body.comments[0].author.image).toBeNull();
  });

  test("Scenario 2: add comment as authenticated user → 201 + envelope", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const slug = await createArticle(jakeApi, `Add ${id}`);

    const res = await jakeApi.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: "Thank you!" } },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as {
      comment: {
        id: number;
        body: string;
        author: { username: string };
      };
    };
    expect(body.comment.body).toBe("Thank you!");
    expect(body.comment.author.username).toBe(jake);
    expect(Number.isInteger(body.comment.id)).toBe(true);

    // Round-trip: GET lists it.
    const listRes = await jakeApi.get(`/api/articles/${slug}/comments`);
    const list = (await listRes.json()) as { comments: Array<{ id: number }> };
    expect(list.comments.map((c) => c.id)).toContain(body.comment.id);
  });

  test("Scenario 3: delete own comment → 204, subsequent list omits it", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const slug = await createArticle(jakeApi, `Del ${id}`);
    const commentId = await addComment(jakeApi, slug, "delete me");

    const del = await jakeApi.delete(`/api/articles/${slug}/comments/${commentId}`);
    expect(del.status()).toBe(204);
    const delBody = await del.body();
    expect(delBody.byteLength).toBe(0);

    const list = await jakeApi.get(`/api/articles/${slug}/comments`);
    const body = (await list.json()) as { comments: Array<{ id: number }> };
    expect(body.comments.map((c) => c.id)).not.toContain(commentId);
  });

  test("Scenario 4: delete someone else's comment → 403", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Owned ${id}`);
    const danCommentId = await addComment(danApi, slug, "dan's comment");

    const res = await jakeApi.delete(`/api/articles/${slug}/comments/${danCommentId}`);
    expect(res.status()).toBe(403);

    // Sanity: comment still exists.
    const list = await jakeApi.get(`/api/articles/${slug}/comments`);
    const body = (await list.json()) as { comments: Array<{ id: number }> };
    expect(body.comments.map((c) => c.id)).toContain(danCommentId);
  });

  test("Scenario 5: anon POST + DELETE → 401 each", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const slug = await createArticle(jakeApi, `Auth ${id}`);
    const commentId = await addComment(jakeApi, slug, "gate");

    const anon = await request.newContext({ baseURL: API_URL });
    const post = await anon.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: "anon try" } },
    });
    expect(post.status()).toBe(401);
    const del = await anon.delete(`/api/articles/${slug}/comments/${commentId}`);
    expect(del.status()).toBe(401);
  });

  test("Scenario 6: any comment op on non-existent slug → 404", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);

    const anon = await request.newContext({ baseURL: API_URL });
    const missing = `does-not-exist-${id}`;
    const getRes = await anon.get(`/api/articles/${missing}/comments`);
    expect(getRes.status()).toBe(404);

    const postRes = await jakeApi.post(`/api/articles/${missing}/comments`, {
      data: { comment: { body: "ghost" } },
    });
    expect(postRes.status()).toBe(404);

    const delRes = await jakeApi.delete(`/api/articles/${missing}/comments/1`);
    expect(delRes.status()).toBe(404);
  });

  test("Scenario 7: empty body → 422 with errors.body", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const slug = await createArticle(jakeApi, `Empty ${id}`);

    const res = await jakeApi.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: "" } },
    });
    expect(res.status()).toBe(422);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    const allMessages = Object.values(body.errors).flat().join(" ");
    expect(allMessages.toLowerCase()).toContain("can't be blank");
  });
});
