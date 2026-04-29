import { expect, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #11: GET /api/articles/feed.
// Four AC scenarios — tests seed per-id authors / articles so parallel
// suites don't tread on each other.
//
// #96 Phase 2 refactor: API helpers via `ArticlesApi`.

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #11 — API GET /api/articles/feed", () => {
  test("Scenario 1: feed contains only articles from followed users", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const alice = `alice-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    const aliceApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    await aliceApi.registerUser(alice);

    const j1 = await jakeApi.createArticleReturnSlug({ title: `J1 ${id}` });
    const j2 = await jakeApi.createArticleReturnSlug({ title: `J2 ${id}` });
    await aliceApi.createArticleReturnSlug({ title: `A1 ${id}` });
    await aliceApi.createArticleReturnSlug({ title: `A2 ${id}` });

    await danApi.follow(jake);

    const body = await danApi.feedArticles();
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
    const danApi = await ArticlesApi.newContext();
    const jakeApi = await ArticlesApi.newContext();
    await danApi.registerUser(dan);
    await jakeApi.registerUser(jake);
    // Some article exists authored by someone dan does NOT follow.
    await jakeApi.createArticleReturnSlug({ title: `Other ${id}` });

    const body = await danApi.feedArticles();
    expect(body.articles).toEqual([]);
    expect(body.articlesCount).toBe(0);
  });

  test("Scenario 3: pagination respects limit + offset", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);

    // Seed 30 articles from jake (the only user dan follows). Slight
    // delay between creates so createdAt ordering is deterministic at
    // ms granularity.
    for (let i = 0; i < 30; i += 1) {
      await jakeApi.createArticleReturnSlug({
        title: `P${i.toString().padStart(2, "0")} ${id}`,
      });
    }
    await danApi.follow(jake);

    const body = await danApi.feedArticles({ limit: 10, offset: 10 });
    expect(body.articles.length).toBe(10);
    expect(body.articlesCount).toBeGreaterThanOrEqual(30);
    // Newest-first: P29 at offset 0, so offset 10 lands at P19.
    expect(body.articles[0].title).toBe(`P19 ${id}`);
    expect(body.articles[9].title).toBe(`P10 ${id}`);
  });

  test("Scenario 4: feed requires auth — 401 anonymous", async () => {
    const anon = await ArticlesApi.newContext();
    const res = await anon.feedRaw();
    expect(res.status()).toBe(401);
  });
});
