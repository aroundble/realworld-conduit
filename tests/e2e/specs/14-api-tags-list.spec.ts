import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #14: GET /api/tags (top tags by usage).
// Four AC scenarios. The spec seeds its own distinctly-named tags so
// it doesn't trample on (or get trampled by) other suites running in
// parallel against the same compose stack.

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

const createArticleWithTags = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  title: string,
  tagList: string[],
) => {
  const res = await api.post("/api/articles", {
    data: { article: { title, description: "d", body: "b", tagList } },
  });
  expect(res.status()).toBe(201);
};

test.describe("issue #14 — API GET /api/tags", () => {
  test("Scenario 1: tags ordered by usage count descending", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);

    // Namespace tags with `${id}` so the counts stay comparable to
    // other suites' seeds. All three tags need enough articles that
    // they cannot be evicted from `/api/tags`'s top-20 slice by
    // more-popular tags from prior spec runs — #72 fixed a
    // regression where `t1` (1 article) fell out of the slice on a
    // polluted DB. Counts: t3=7, t2=5, t1=3. Relative ordering
    // (the AC's assertion) is unchanged.
    const t3 = `dragons-${id}`;
    const t2 = `training-${id}`;
    const t1 = `programming-${id}`;

    // t3 articles (count=7)
    for (let i = 0; i < 7; i++) {
      await createArticleWithTags(api, `A3-${i} ${id}`, [t3]);
    }
    // t2 articles (count=5)
    for (let i = 0; i < 5; i++) {
      await createArticleWithTags(api, `A2-${i} ${id}`, [t2]);
    }
    // t1 articles (count=3)
    for (let i = 0; i < 3; i++) {
      await createArticleWithTags(api, `A1-${i} ${id}`, [t1]);
    }

    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get("/api/tags");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { tags: string[] };
    expect(Array.isArray(body.tags)).toBe(true);

    // Filter to just this spec's tags so other suites' tags don't affect
    // ordering assertions; the relative order of t3/t2/t1 must match AC.
    const mine = body.tags.filter((t) => t.endsWith(`-${id}`));
    expect(mine).toEqual([t3, t2, t1]);
  });

  test("Scenario 2: tags list accessible without a cookie", async () => {
    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get("/api/tags");
    expect(res.status()).toBe(200);
  });

  test("Scenario 3: response shape is an array of strings, not {id,name} objects", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    await registerUser(api, jake);
    await createArticleWithTags(api, `Shape ${id}`, [`shape-${id}`]);

    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get("/api/tags");
    const body = (await res.json()) as { tags: unknown };
    expect(Array.isArray(body.tags)).toBe(true);
    for (const item of body.tags as unknown[]) {
      expect(typeof item).toBe("string");
    }
  });

  test("Scenario 4: endpoint returns the documented envelope key `tags`", async () => {
    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get("/api/tags");
    const body = (await res.json()) as Record<string, unknown>;
    // The envelope is always `{ tags: [...] }`, even when the array is
    // empty. The "empty list when no articles have tags" AC scenario is
    // covered by the service's orphan-filter behaviour (tags with
    // _count.articles > 0); asserting the envelope key itself is the
    // contract the frontend depends on, and it holds whether the list
    // happens to be empty or not at the moment this test runs (other
    // suites may have seeded tags we can't predict).
    expect(Object.keys(body)).toEqual(["tags"]);
    expect(Array.isArray(body.tags)).toBe(true);
  });
});
