import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #10: GET /api/articles with filters + pagination.
// Seven AC scenarios. Each test seeds distinctly-named users / tags /
// titles so it can run alongside other specs without cross-contamination.
//
// #96 Phase 2 refactor: API helpers live in `ArticlesApi` now (each
// spec previously had its own local `registerUser` / `createArticle`).

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #10 — API GET /api/articles", () => {
  test("Scenario 1: default list returns newest first + articlesCount", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    const s1 = await api.createArticleReturnSlug({ title: `A1 ${id}` });
    await new Promise((r) => setTimeout(r, 20));
    const s2 = await api.createArticleReturnSlug({ title: `A2 ${id}` });
    await new Promise((r) => setTimeout(r, 20));
    const s3 = await api.createArticleReturnSlug({ title: `A3 ${id}` });

    const body = await api.listArticles({ author: jake });
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
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    const dragons = `dragons-${id}`;
    const training = `training-${id}`;

    const slugA = await api.createArticleReturnSlug({
      title: `A ${id}`,
      tagList: [dragons],
    });
    await api.createArticleReturnSlug({
      title: `B ${id}`,
      tagList: [training],
    });
    const slugC = await api.createArticleReturnSlug({
      title: `C ${id}`,
      tagList: [dragons, training],
    });

    const body = await api.listArticles({ tag: dragons });
    expect(body.articlesCount).toBe(2);
    expect(body.articles.map((a) => a.slug).sort()).toEqual([slugA, slugC].sort());
  });

  test("Scenario 3: filter by author returns only that author's articles", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);

    await jakeApi.createArticleReturnSlug({ title: `J1 ${id}` });
    await jakeApi.createArticleReturnSlug({ title: `J2 ${id}` });
    await danApi.createArticleReturnSlug({ title: `D1 ${id}` });

    const body = await jakeApi.listArticles({ author: jake });
    expect(body.articlesCount).toBe(2);
    for (const a of body.articles) {
      expect(a.author.username).toBe(jake);
    }
  });

  test("Scenario 4: filter by favorited-by-username", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);

    const slugA = await jakeApi.createArticleReturnSlug({ title: `Fav-A ${id}` });
    await jakeApi.createArticleReturnSlug({ title: `Fav-B ${id}` });

    await danApi.favorite(slugA);

    const body = await jakeApi.listArticles({ favorited: dan });
    expect(body.articlesCount).toBe(1);
    expect(body.articles[0].slug).toBe(slugA);
  });

  test("Scenario 5: pagination respects limit + offset", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    // Seed 25 articles. Author filter isolates this spec from others
    // running in parallel against the same stack.
    for (let i = 0; i < 25; i += 1) {
      await api.createArticleReturnSlug({
        title: `P${i.toString().padStart(2, "0")} ${id}`,
      });
    }

    const body = await api.listArticles({ author: jake, limit: 10, offset: 10 });
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
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);

    const slugA = await jakeApi.createArticleReturnSlug({ title: `S6 ${id}` });
    await danApi.favorite(slugA);
    await danApi.follow(jake);

    const body = await danApi.listArticles({ author: jake });
    const a = body.articles.find((x) => x.slug === slugA);
    expect(a, "article A should be in the response").toBeDefined();
    expect(a!.favorited).toBe(true);
    expect(a!.favoritesCount).toBe(1);
    expect(a!.author.following).toBe(true);
  });

  test("Scenario 7: invalid limit is rejected with 422", async () => {
    // Raw request — we want the 422 response body, not the POP's
    // wrapped assertion.
    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get(`/api/articles?limit=999`);
    expect(res.status()).toBe(422);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    const allMessages = Object.values(body.errors).flat().join(" ");
    expect(allMessages.toLowerCase()).toContain("must be at most 100");
  });
});
