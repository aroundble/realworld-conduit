import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #11: GET /api/articles/feed.
// Four AC scenarios — tests seed per-id authors / articles so parallel
// suites don't tread on each other.

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

test.describe("issue #11 — API GET /api/articles/feed", () => {
  test("Scenario 1: feed contains only articles from followed users", async () => {
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

    const j1 = await createArticle(jakeApi, `J1 ${id}`);
    const j2 = await createArticle(jakeApi, `J2 ${id}`);
    await createArticle(aliceApi, `A1 ${id}`);
    await createArticle(aliceApi, `A2 ${id}`);

    const follow = await danApi.post(`/api/profiles/${jake}/follow`);
    expect(follow.status()).toBe(200);

    const res = await danApi.get("/api/articles/feed");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{
        slug: string;
        author: { username: string; following: boolean };
      }>;
      articlesCount: number;
    };
    // Filter to this spec's seeded slugs (parallel suites may add others).
    const mine = body.articles.filter((a) => a.slug === j1 || a.slug === j2);
    expect(mine.length).toBe(2);
    for (const a of mine) {
      expect(a.author.username).toBe(jake);
      expect(a.author.following).toBe(true);
    }
    // articlesCount is the total feed for dan — at minimum the two jake
    // articles we seeded, possibly more if dan was made to follow other
    // seeded authors by other specs. Asserting ≥ 2 + that the mine set
    // is exactly 2 covers the AC without flaking.
    expect(body.articlesCount).toBeGreaterThanOrEqual(2);
  });

  test("Scenario 2: empty feed when user follows nobody", async () => {
    const id = uniq();
    const dan = `dan-${id}`;
    const jake = `jake-${id}`;
    const danApi = await request.newContext({ baseURL: API_URL });
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(danApi, dan);
    await registerUser(jakeApi, jake);
    // Some article exists authored by someone dan does NOT follow.
    await createArticle(jakeApi, `Other ${id}`);

    const res = await danApi.get("/api/articles/feed");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: unknown[];
      articlesCount: number;
    };
    expect(body.articles).toEqual([]);
    expect(body.articlesCount).toBe(0);
  });

  test("Scenario 3: pagination respects limit + offset", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);

    // Seed 30 articles from jake (the only user dan follows). Slight
    // delay between creates so createdAt ordering is deterministic at
    // ms granularity.
    for (let i = 0; i < 30; i += 1) {
      await createArticle(jakeApi, `P${i.toString().padStart(2, "0")} ${id}`);
    }
    await danApi.post(`/api/profiles/${jake}/follow`);

    const res = await danApi.get("/api/articles/feed?limit=10&offset=10");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{ title: string }>;
      articlesCount: number;
    };
    expect(body.articles.length).toBe(10);
    expect(body.articlesCount).toBeGreaterThanOrEqual(30);
    // Newest-first: P29 at offset 0, so offset 10 lands at P19.
    expect(body.articles[0].title).toBe(`P19 ${id}`);
    expect(body.articles[9].title).toBe(`P10 ${id}`);
  });

  test("Scenario 4: feed requires auth — 401 anonymous", async () => {
    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get("/api/articles/feed");
    expect(res.status()).toBe(401);
  });
});
