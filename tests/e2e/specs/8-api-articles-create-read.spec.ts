import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #8: POST /api/articles + GET /api/articles/:slug.
// Six scenarios from the issue body. Article envelope shape is
// spec-literal: slug, title, description, body, tagList, createdAt,
// updatedAt, favorited (placeholder false until #12), favoritesCount
// (placeholder 0 until #12), author (Profile sub-object with viewer-
// relative following). This spec doesn't touch favorite-related
// behaviour — those AC belong to #12.
//
// #96 Phase 2 refactor: API helpers via `ArticlesApi`. Scenarios 5 + 6
// need raw responses (404 / 401 / 422), so they use request.newContext
// directly — the POP's wrappers assert 200/201/204 status.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #8 — API articles (create + read by slug)", () => {
  test("Scenario 1: create article with tags computes unique slug + persists tag rows", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    const article = await api.createArticle({
      title: "How to train your dragon",
      description: "Ever wonder how?",
      body: "You have to believe",
      tagList: ["dragons", "training"],
    });
    expect(article.slug).toMatch(/^how-to-train-your-dragon-[a-z0-9]{4}$/);
    expect(article.title).toBe("How to train your dragon");
    expect(article.description).toBe("Ever wonder how?");
    expect(article.body).toBe("You have to believe");
    expect(article.tagList.sort()).toEqual(["dragons", "training"]);
    expect(Date.parse(article.createdAt)).toBeGreaterThan(0);
    expect(Date.parse(article.updatedAt)).toBeGreaterThan(0);
    expect(article.favorited).toBe(false);
    expect(article.favoritesCount).toBe(0);
    expect(article.author.username).toBe(jake);
    expect(article.author.bio).toBeNull();
    expect(article.author.image).toBeNull();
    expect(article.author.following).toBe(false);
  });

  test("Scenario 2: two articles with the same title get distinct slugs", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    const input = { title: `Same title ${id}` };
    const a = await api.createArticle(input);
    const b = await api.createArticle(input);
    expect(a.slug).not.toBe(b.slug);
    // Both slugs share the same base (slugify(title)) but differ in the
    // 4-char suffix.
    const base = a.slug.replace(/-[a-z0-9]{4}$/, "");
    expect(b.slug.startsWith(base + "-")).toBe(true);
  });

  test("Scenario 3: anonymous read by slug returns envelope with following=false", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    const slug = await jakeApi.createArticleReturnSlug({ title: `Anon read ${id}` });

    const anonApi = await ArticlesApi.newContext();
    const article = await anonApi.readBySlug(slug);
    expect(article.slug).toBe(slug);
    expect(article.favorited).toBe(false);
    expect(article.author.following).toBe(false);
  });

  test("Scenario 4: authenticated viewer who follows the author sees following=true", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);

    const slug = await jakeApi.createArticleReturnSlug({ title: `Follow-check ${id}` });
    await danApi.follow(jake);

    const article = await danApi.readBySlug(slug);
    expect(article.author.following).toBe(true);
  });

  test("Scenario 5: read non-existent slug returns 404", async () => {
    // Raw request — POP's readBySlug expects 200.
    const anonApi = await request.newContext({ baseURL: API_URL });
    const res = await anonApi.get("/api/articles/no-such-slug-exists");
    expect(res.status()).toBe(404);
  });

  test("Scenario 6: create requires auth and validates body", async () => {
    // Raw request — POP's createArticle asserts 201.
    const anonApi = await request.newContext({ baseURL: API_URL });
    const anon = await anonApi.post("/api/articles", {
      data: { article: { title: "t", description: "d", body: "b" } },
    });
    expect(anon.status()).toBe(401);

    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    const blank = await jakeApi.api.post("/api/articles", {
      data: { article: { title: "", description: "d", body: "b" } },
    });
    expect(blank.status()).toBe(422);
    const body = (await blank.json()) as { errors: Record<string, string[]> };
    // The API's global zod-validator emits `errors.body` for any
    // request-body schema failure; the field path is inside each
    // message. Asserting both the envelope shape and the message
    // substring keeps the test spec-conformant without over-fitting
    // the validator's exact output format.
    const allMessages = Object.values(body.errors).flat().join(" ");
    expect(allMessages.toLowerCase()).toContain("can't be blank");
  });
});
