import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #12: POST + DELETE /api/articles/:slug/favorite.
// Six of the seven AC scenarios run here; scenario 5 ("other article
// envelopes reflect real favorite data") touches the list endpoint
// (GET /api/articles) which ships in #10. The detail-endpoint half of
// the integration (POST favorite → subsequent GET /:slug envelope
// carries real favorited/favoritesCount) is exercised throughout.
// When #10 merges its own spec can assert the list-envelope half with
// one extra seed; no changes needed here.

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

test.describe("issue #12 — API favorite / unfavorite article", () => {
  test("Scenario 1: first favorite flips count 0 → 1 and favorited true", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Favorite me ${id}`);

    // Baseline: envelope reports 0 + false pre-favorite.
    const before = await danApi.get(`/api/articles/${slug}`);
    const beforeBody = (await before.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(beforeBody.article.favoritesCount).toBe(0);
    expect(beforeBody.article.favorited).toBe(false);

    const fav = await danApi.post(`/api/articles/${slug}/favorite`);
    expect(fav.status()).toBe(200);
    const favBody = (await fav.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(favBody.article.favoritesCount).toBe(1);
    expect(favBody.article.favorited).toBe(true);
  });

  test("Scenario 2: favoriting twice is idempotent — count stays 1", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Idempotent ${id}`);

    await danApi.post(`/api/articles/${slug}/favorite`);
    const second = await danApi.post(`/api/articles/${slug}/favorite`);
    expect(second.status()).toBe(200);
    const body = (await second.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(body.article.favoritesCount).toBe(1);
    expect(body.article.favorited).toBe(true);
  });

  test("Scenario 3: unfavorite flips count 1 → 0 and favorited false", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Unfavorite ${id}`);

    await danApi.post(`/api/articles/${slug}/favorite`);
    const un = await danApi.delete(`/api/articles/${slug}/favorite`);
    expect(un.status()).toBe(200);
    const body = (await un.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(body.article.favoritesCount).toBe(0);
    expect(body.article.favorited).toBe(false);
  });

  test("Scenario 4: favoritesCount reflects multiple users", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const alice = `alice-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    const aliceApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    await registerUser(aliceApi, alice);
    const slug = await createArticle(jakeApi, `Multi-fav ${id}`);

    await danApi.post(`/api/articles/${slug}/favorite`);
    await aliceApi.post(`/api/articles/${slug}/favorite`);

    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get(`/api/articles/${slug}`);
    const body = (await res.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(body.article.favoritesCount).toBe(2);
    // Anonymous viewer sees favorited=false regardless of other users'
    // state — `favorited` is strictly viewer-relative.
    expect(body.article.favorited).toBe(false);
  });

  test("Scenario 5 (detail-endpoint half): viewer-relative favorited is per-user", async () => {
    // The list-endpoint half (GET /api/articles) lands with #10. This
    // spec covers the same invariant against GET /api/articles/:slug:
    // when dan has favorited but alice hasn't, fetching the same slug
    // with each viewer's cookie returns different `favorited` flags.
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const alice = `alice-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    const aliceApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    await registerUser(aliceApi, alice);
    const slug = await createArticle(jakeApi, `Per-viewer ${id}`);

    await danApi.post(`/api/articles/${slug}/favorite`);

    const danView = await danApi.get(`/api/articles/${slug}`);
    const danBody = (await danView.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(danBody.article.favorited).toBe(true);
    expect(danBody.article.favoritesCount).toBe(1);

    const aliceView = await aliceApi.get(`/api/articles/${slug}`);
    const aliceBody = (await aliceView.json()) as {
      article: { favorited: boolean; favoritesCount: number };
    };
    expect(aliceBody.article.favorited).toBe(false);
    expect(aliceBody.article.favoritesCount).toBe(1);
  });

  test("Scenario 6: favorite endpoints require auth", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const slug = await createArticle(jakeApi, `Auth-check ${id}`);

    const anon = await request.newContext({ baseURL: API_URL });
    const post = await anon.post(`/api/articles/${slug}/favorite`);
    expect(post.status()).toBe(401);
    const del = await anon.delete(`/api/articles/${slug}/favorite`);
    expect(del.status()).toBe(401);
  });

  test("Scenario 7: favorite non-existent article → 404", async () => {
    const id = uniq();
    const dan = `dan-${id}`;
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(danApi, dan);

    const res = await danApi.post(`/api/articles/no-such-slug-${id}/favorite`);
    expect(res.status()).toBe(404);
  });
});
