import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #8: POST /api/articles + GET /api/articles/:slug.
// Six scenarios from the issue body. Article envelope shape is
// spec-literal: slug, title, description, body, tagList, createdAt,
// updatedAt, favorited (placeholder false until #12), favoritesCount
// (placeholder 0 until #12), author (Profile sub-object with viewer-
// relative following). This spec doesn't touch favorite-related
// behaviour — those AC belong to #12.

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

test.describe("issue #8 — API articles (create + read by slug)", () => {
  test("Scenario 1: create article with tags computes unique slug + persists tag rows", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);

    const res = await api.post("/api/articles", {
      data: {
        article: {
          title: "How to train your dragon",
          description: "Ever wonder how?",
          body: "You have to believe",
          tagList: ["dragons", "training"],
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { article: Record<string, unknown> };
    const article = body.article as {
      slug: string;
      title: string;
      description: string;
      body: string;
      tagList: string[];
      createdAt: string;
      updatedAt: string;
      favorited: boolean;
      favoritesCount: number;
      author: { username: string; bio: unknown; image: unknown; following: boolean };
    };
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
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);

    const payload = {
      article: { title: `Same title ${id}`, description: "d", body: "b" },
    };
    const first = await api.post("/api/articles", { data: payload });
    const second = await api.post("/api/articles", { data: payload });
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    const a = (await first.json()) as { article: { slug: string } };
    const b = (await second.json()) as { article: { slug: string } };
    expect(a.article.slug).not.toBe(b.article.slug);
    // Both slugs share the same base (slugify(title)) but differ in the
    // 4-char suffix.
    const base = a.article.slug.replace(/-[a-z0-9]{4}$/, "");
    expect(b.article.slug.startsWith(base + "-")).toBe(true);
  });

  test("Scenario 3: anonymous read by slug returns envelope with following=false", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const created = await jakeApi.post("/api/articles", {
      data: { article: { title: `Anon read ${id}`, description: "d", body: "b" } },
    });
    const slug = ((await created.json()) as { article: { slug: string } }).article.slug;

    const anonApi = await request.newContext({ baseURL: API_URL });
    const res = await anonApi.get(`/api/articles/${slug}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      article: { slug: string; favorited: boolean; author: { following: boolean } };
    };
    expect(body.article.slug).toBe(slug);
    expect(body.article.favorited).toBe(false);
    expect(body.article.author.following).toBe(false);
  });

  test("Scenario 4: authenticated viewer who follows the author sees following=true", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);

    const created = await jakeApi.post("/api/articles", {
      data: { article: { title: `Follow-check ${id}`, description: "d", body: "b" } },
    });
    const slug = ((await created.json()) as { article: { slug: string } }).article.slug;

    const follow = await danApi.post(`/api/profiles/${jake}/follow`);
    expect(follow.status()).toBe(200);

    const res = await danApi.get(`/api/articles/${slug}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: { author: { following: boolean } } };
    expect(body.article.author.following).toBe(true);
  });

  test("Scenario 5: read non-existent slug returns 404", async () => {
    const anonApi = await request.newContext({ baseURL: API_URL });
    const res = await anonApi.get("/api/articles/no-such-slug-exists");
    expect(res.status()).toBe(404);
  });

  test("Scenario 6: create requires auth and validates body", async () => {
    const anonApi = await request.newContext({ baseURL: API_URL });
    const anon = await anonApi.post("/api/articles", {
      data: { article: { title: "t", description: "d", body: "b" } },
    });
    expect(anon.status()).toBe(401);

    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const blank = await jakeApi.post("/api/articles", {
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
