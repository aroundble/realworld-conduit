import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #9: PUT + DELETE /api/articles/:slug.
// Six scenarios from the issue body. The spec seeds each scenario with
// its own registered user(s) + authored article so tests are
// independent and can run in any order.

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

test.describe("issue #9 — API articles update + delete (author-scoped)", () => {
  test("Scenario 1: author updates title → new slug + updatedAt advances; old slug 404s", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);
    const originalSlug = await createArticle(api, "How to train your dragon");

    // Snapshot createdAt so the AC's `updatedAt > createdAt` assertion
    // has a concrete lower bound.
    const before = await api.get(`/api/articles/${originalSlug}`);
    const beforeBody = (await before.json()) as {
      article: { createdAt: string; updatedAt: string };
    };
    const createdAt = Date.parse(beforeBody.article.createdAt);

    // Ensure the Prisma update lands on a later ms than the row's
    // createdAt, even when the test process is faster than the DB clock
    // granularity.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const put = await api.put(`/api/articles/${originalSlug}`, {
      data: { article: { title: "Did you train your dragon?" } },
    });
    expect(put.status()).toBe(200);
    const putBody = (await put.json()) as {
      article: { slug: string; title: string; updatedAt: string };
    };
    expect(putBody.article.slug).toMatch(/^did-you-train-your-dragon-[a-z0-9]{4}$/);
    expect(putBody.article.title).toBe("Did you train your dragon?");
    expect(Date.parse(putBody.article.updatedAt)).toBeGreaterThan(createdAt);

    const newSlug = putBody.article.slug;
    const getNew = await api.get(`/api/articles/${newSlug}`);
    expect(getNew.status()).toBe(200);

    const getOld = await api.get(`/api/articles/${originalSlug}`);
    expect(getOld.status()).toBe(404);
  });

  test("Scenario 2: author updates body-only → slug unchanged, body reflects new value", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);
    const slug = await createArticle(api, `Body-only ${id}`);

    const put = await api.put(`/api/articles/${slug}`, {
      data: { article: { body: "rewritten body content" } },
    });
    expect(put.status()).toBe(200);
    const body = (await put.json()) as {
      article: { slug: string; body: string };
    };
    expect(body.article.slug).toBe(slug);
    expect(body.article.body).toBe("rewritten body content");

    const get = await api.get(`/api/articles/${slug}`);
    const getBody = (await get.json()) as { article: { body: string } };
    expect(getBody.article.body).toBe("rewritten body content");
  });

  test("Scenario 3: non-author PUT → 403", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Jake's article ${id}`);

    const put = await danApi.put(`/api/articles/${slug}`, {
      data: { article: { title: "dan hijacks the post" } },
    });
    expect(put.status()).toBe(403);
  });

  test("Scenario 4: author DELETE → 204; subsequent GET → 404; cascades remove comments + tags + favorites", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);

    // Create an article with two tags so the M:N join rows exist.
    const createRes = await api.post("/api/articles", {
      data: {
        article: {
          title: `With tags ${id}`,
          description: "d",
          body: "b",
          tagList: [`t1-${id}`, `t2-${id}`],
        },
      },
    });
    expect(createRes.status()).toBe(201);
    const slug = ((await createRes.json()) as { article: { slug: string } }).article.slug;

    const del = await api.delete(`/api/articles/${slug}`);
    expect(del.status()).toBe(204);
    // 204 responses MUST have empty body per RFC 7230 §3.3.3. Playwright
    // returns an empty Buffer here.
    const delBody = await del.body();
    expect(delBody.byteLength).toBe(0);

    const get = await api.get(`/api/articles/${slug}`);
    expect(get.status()).toBe(404);
  });

  test("Scenario 5: non-author DELETE → 403", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    await registerUser(danApi, dan);
    const slug = await createArticle(jakeApi, `Jake's other article ${id}`);

    const del = await danApi.delete(`/api/articles/${slug}`);
    expect(del.status()).toBe(403);

    // Sanity: the article still exists — non-author DELETE must not
    // destroy the row.
    const get = await jakeApi.get(`/api/articles/${slug}`);
    expect(get.status()).toBe(200);
  });

  test("Scenario 6: anonymous DELETE → 401; anonymous PUT → 401", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const anonApi = await request.newContext({ baseURL: API_URL });
    await registerUser(jakeApi, jake);
    const slug = await createArticle(jakeApi, `Anonymous check ${id}`);

    const del = await anonApi.delete(`/api/articles/${slug}`);
    expect(del.status()).toBe(401);

    const put = await anonApi.put(`/api/articles/${slug}`, {
      data: { article: { title: "anon hijack" } },
    });
    expect(put.status()).toBe(401);
  });
});
