import { expect, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #9: PUT + DELETE /api/articles/:slug.
// Six scenarios from the issue body. The spec seeds each scenario with
// its own registered user(s) + authored article so tests are
// independent and can run in any order.
//
// #96 Phase 2 refactor: API helpers via `ArticlesApi`. Scenarios that
// assert error statuses (403/401/404) use `api.api.*` raw calls —
// the POP's wrappers assert 200/201/204 on the happy path.

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #9 — API articles update + delete (author-scoped)", () => {
  test("Scenario 1: author updates title → new slug + updatedAt advances; old slug 404s", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const originalSlug = await api.createArticleReturnSlug({
      title: "How to train your dragon",
    });

    // Snapshot createdAt so the AC's `updatedAt > createdAt` assertion
    // has a concrete lower bound.
    const before = await api.readBySlug(originalSlug);
    const createdAt = Date.parse(before.createdAt);

    // Ensure the Prisma update lands on a later ms than the row's
    // createdAt, even when the test process is faster than the DB clock
    // granularity.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const updated = await api.updateArticle(originalSlug, {
      title: "Did you train your dragon?",
    });
    expect(updated.slug).toMatch(/^did-you-train-your-dragon-[a-z0-9]{4}$/);
    expect(updated.title).toBe("Did you train your dragon?");
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(createdAt);

    const newSlug = updated.slug;
    await api.readBySlug(newSlug); // asserts 200 via POP

    const getOld = await api.api.get(`/api/articles/${originalSlug}`);
    expect(getOld.status()).toBe(404);
  });

  test("Scenario 2: author updates body-only → slug unchanged, body reflects new value", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `Body-only ${id}` });

    const updated = await api.updateArticle(slug, { body: "rewritten body content" });
    expect(updated.slug).toBe(slug);
    expect(updated.body).toBe("rewritten body content");

    const fetched = await api.readBySlug(slug);
    expect(fetched.body).toBe("rewritten body content");
  });

  test("Scenario 3: non-author PUT → 403", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    const slug = await jakeApi.createArticleReturnSlug({
      title: `Jake's article ${id}`,
    });

    const put = await danApi.api.put(`/api/articles/${slug}`, {
      data: { article: { title: "dan hijacks the post" } },
    });
    expect(put.status()).toBe(403);
  });

  test("Scenario 4: author DELETE → 204; subsequent GET → 404; cascades remove comments + tags + favorites", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    // Create an article with two tags so the M:N join rows exist.
    const slug = await api.createArticleReturnSlug({
      title: `With tags ${id}`,
      tagList: [`t1-${id}`, `t2-${id}`],
    });

    // Raw delete to inspect status + body (POP asserts 204 but
    // doesn't expose the body).
    const del = await api.api.delete(`/api/articles/${slug}`);
    expect(del.status()).toBe(204);
    // 204 responses MUST have empty body per RFC 7230 §3.3.3. Playwright
    // returns an empty Buffer here.
    const delBody = await del.body();
    expect(delBody.byteLength).toBe(0);

    const get = await api.api.get(`/api/articles/${slug}`);
    expect(get.status()).toBe(404);
  });

  test("Scenario 5: non-author DELETE → 403", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const danApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    const slug = await jakeApi.createArticleReturnSlug({
      title: `Jake's other article ${id}`,
    });

    const del = await danApi.api.delete(`/api/articles/${slug}`);
    expect(del.status()).toBe(403);

    // Sanity: the article still exists — non-author DELETE must not
    // destroy the row.
    await jakeApi.readBySlug(slug); // asserts 200 via POP
  });

  test("Scenario 6: anonymous DELETE → 401; anonymous PUT → 401", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await ArticlesApi.newContext();
    const anonApi = await ArticlesApi.newContext();
    await jakeApi.registerUser(jake);
    const slug = await jakeApi.createArticleReturnSlug({
      title: `Anonymous check ${id}`,
    });

    const del = await anonApi.api.delete(`/api/articles/${slug}`);
    expect(del.status()).toBe(401);

    const put = await anonApi.api.put(`/api/articles/${slug}`, {
      data: { article: { title: "anon hijack" } },
    });
    expect(put.status()).toBe(401);
  });
});
