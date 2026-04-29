import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #10: GET /api/articles with filters + pagination.
// Seven AC scenarios. Each test seeds distinctly-named users / tags /
// titles so it can run alongside other specs without cross-contamination.

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
  tagList: string[] = [],
): Promise<string> => {
  const res = await api.post("/api/articles", {
    data: { article: { title, description: "d", body: "b", tagList } },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { article: { slug: string } };
  return body.article.slug;
};

test.describe("issue #10 — API GET /api/articles", () => {
  test("Scenario 1: default list returns newest first + articlesCount", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);

    const s1 = await createArticle(api, `A1 ${id}`);
    await new Promise((r) => setTimeout(r, 20));
    const s2 = await createArticle(api, `A2 ${id}`);
    await new Promise((r) => setTimeout(r, 20));
    const s3 = await createArticle(api, `A3 ${id}`);

    const res = await api.get(`/api/articles?author=${jake}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{ slug: string; createdAt: string }>;
      articlesCount: number;
    };
    expect(body.articlesCount).toBe(3);
    expect(body.articles.map((a) => a.slug)).toEqual([s3, s2, s1]);
    expect(Date.parse(body.articles[0].createdAt)).toBeGreaterThan(
      Date.parse(body.articles[1].createdAt),
    );
    expect(Date.parse(body.articles[1].createdAt)).toBeGreaterThan(
      Date.parse(body.articles[2].createdAt),
    );
  });

  test("Scenario 2: filter by tag returns only articles carrying that tag", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);

    const dragons = `dragons-${id}`;
    const training = `training-${id}`;

    const slugA = await createArticle(api, `A ${id}`, [dragons]);
    await createArticle(api, `B ${id}`, [training]);
    const slugC = await createArticle(api, `C ${id}`, [dragons, training]);

    const res = await api.get(`/api/articles?tag=${dragons}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{ slug: string }>;
      articlesCount: number;
    };
    expect(body.articlesCount).toBe(2);
    expect(body.articles.map((a) => a.slug).sort()).toEqual([slugA, slugC].sort());
  });

  test("Scenario 3: filter by author returns only that author's articles", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);

    await createArticle(jakeApi, `J1 ${id}`);
    await createArticle(jakeApi, `J2 ${id}`);
    await createArticle(danApi, `D1 ${id}`);

    const res = await jakeApi.get(`/api/articles?author=${jake}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{ author: { username: string } }>;
      articlesCount: number;
    };
    expect(body.articlesCount).toBe(2);
    for (const a of body.articles) {
      expect(a.author.username).toBe(jake);
    }
  });

  test("Scenario 4: filter by favorited-by-username", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);

    const slugA = await createArticle(jakeApi, `Fav-A ${id}`);
    await createArticle(jakeApi, `Fav-B ${id}`);

    const fav = await danApi.post(`/api/articles/${slugA}/favorite`);
    expect(fav.status()).toBe(200);

    const res = await jakeApi.get(`/api/articles?favorited=${dan}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{ slug: string }>;
      articlesCount: number;
    };
    expect(body.articlesCount).toBe(1);
    expect(body.articles[0].slug).toBe(slugA);
  });

  test("Scenario 5: pagination respects limit + offset", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);

    // Seed 25 articles. Author filter isolates this spec from others
    // running in parallel against the same stack.
    for (let i = 0; i < 25; i += 1) {
      await createArticle(api, `P${i.toString().padStart(2, "0")} ${id}`);
    }

    const res = await api.get(`/api/articles?author=${jake}&limit=10&offset=10`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{ title: string }>;
      articlesCount: number;
    };
    expect(body.articles.length).toBe(10);
    expect(body.articlesCount).toBe(25);
    // Offset 10 in a newest-first 25-article list = items 14 through 5
    // (0-indexed: items 10 through 19 of the desc-sorted slice).
    // Titles are P24 (newest) down to P00 (oldest); offset 10 starts at P14.
    expect(body.articles[0].title).toBe(`P14 ${id}`);
    expect(body.articles[9].title).toBe(`P05 ${id}`);
  });

  test("Scenario 6: authenticated viewer sees viewer-relative favorited + following", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);

    const slugA = await createArticle(jakeApi, `S6 ${id}`);
    await danApi.post(`/api/articles/${slugA}/favorite`);
    await danApi.post(`/api/profiles/${jake}/follow`);

    const res = await danApi.get(`/api/articles?author=${jake}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      articles: Array<{
        slug: string;
        favorited: boolean;
        favoritesCount: number;
        author: { following: boolean };
      }>;
    };
    const a = body.articles.find((x) => x.slug === slugA);
    expect(a, "article A should be in the response").toBeDefined();
    expect(a!.favorited).toBe(true);
    expect(a!.favoritesCount).toBe(1);
    expect(a!.author.following).toBe(true);
  });

  test("Scenario 7: invalid limit is rejected with 422", async () => {
    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get(`/api/articles?limit=999`);
    expect(res.status()).toBe(422);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    const allMessages = Object.values(body.errors).flat().join(" ");
    expect(allMessages.toLowerCase()).toContain("must be at most 100");
  });
});
