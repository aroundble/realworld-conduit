import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #151 — HTTP cache headers + ETag
// conditional GET. Requires API_CACHE_ENABLED=1 on the api
// compose env; spec skips with a clear message if the flag is
// off, matching the #116 rate-limit-spec pattern.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #151 — API cache headers", () => {
  test.beforeAll(async () => {
    // Probe: fetch /api/tags and look for a public Cache-Control.
    // If missing, the middleware is off and this spec's
    // assertions would be vacuous.
    const ctx = await request.newContext();
    const res = await ctx.get(`${API_URL}/api/tags`);
    const cc = res.headers()["cache-control"] ?? "";
    test.skip(
      !cc.includes("max-age"),
      "API_CACHE_ENABLED is off on the API — this spec needs the middleware active. Set API_CACHE_ENABLED=1 on the api compose env.",
    );
  });

  test("Scenario 1: GET /api/articles (anon) — short TTL public cache", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API_URL}/api/articles?limit=5`);
    expect(res.status()).toBe(200);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/max-age=60/);
    expect(cc).toMatch(/stale-while-revalidate=300/);
    const vary = res.headers()["vary"] ?? "";
    expect(vary).toMatch(/Accept/);
    expect(vary).toMatch(/Accept-Encoding/);
  });

  test("Scenario 2: GET /api/tags — longer TTL", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API_URL}/api/tags`);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/max-age=300/);
    expect(cc).toMatch(/stale-while-revalidate=900/);
  });

  test("Scenario 3: GET /api/profiles/:username (anon) — moderate TTL", async () => {
    // Seed a user with an authed context, then probe /profiles
    // from a fresh anon context so the middleware classifies the
    // GET as public.
    const id = uniq();
    const jake = `c-p-${id}`;
    const seedApi = await ArticlesApi.newContext();
    await seedApi.registerUser(jake);

    const anon = await request.newContext();
    const res = await anon.get(`${API_URL}/api/profiles/${jake}`);
    expect(res.status()).toBe(200);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/max-age=120/);
    expect(cc).toMatch(/stale-while-revalidate=600/);
  });

  test("Scenario 4: GET /api/articles/:slug (anon) — short TTL", async () => {
    const id = uniq();
    const jake = `c-a-${id}`;
    const seedApi = await ArticlesApi.newContext();
    await seedApi.registerUser(jake);
    const slug = await seedApi.createArticleReturnSlug({ title: `cache-${id}` });

    const anon = await request.newContext();
    const res = await anon.get(`${API_URL}/api/articles/${slug}`);
    expect(res.status()).toBe(200);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/max-age=60/);
  });

  test("Scenario 5: GET /api/articles?q= (search) — tighter TTL", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API_URL}/api/articles?q=nothing-matches-${uniq()}`);
    expect(res.status()).toBe(200);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/max-age=30/);
  });

  test("Scenario 6: authenticated GET gets private no-cache", async () => {
    const id = uniq();
    const jake = `c-auth-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    // Feed endpoint requires auth — our ArticlesApi context sends
    // the session cookie, so the middleware should flip to private.
    const res = await api.api.get(`/api/articles/feed`);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/private/);
    expect(cc).toMatch(/no-cache/);
  });

  test("Scenario 7: mutation gets no-store", async () => {
    const id = uniq();
    const jake = `c-m-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    // Any POST — creating an article — should carry no-store.
    const res = await api.api.post(`/api/articles`, {
      data: {
        article: {
          title: `mut-${id}`,
          description: "d",
          body: "b",
        },
      },
    });
    expect(res.status()).toBe(201);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/no-store/);
  });

  test("Scenario 8: ETag + If-None-Match round-trip returns 304", async () => {
    const ctx = await request.newContext();
    const first = await ctx.get(`${API_URL}/api/tags`);
    expect(first.status()).toBe(200);
    const etag = first.headers()["etag"];
    expect(etag).toBeTruthy();
    expect(etag).toMatch(/^"[0-9a-f]+"$/);

    // Second fetch with If-None-Match — since the resource hasn't
    // changed, expect 304 with an empty body.
    const second = await ctx.get(`${API_URL}/api/tags`, {
      headers: { "If-None-Match": etag! },
    });
    expect(second.status()).toBe(304);
    const body = await second.body();
    expect(body.length).toBe(0);
    // 304 should still carry the Cache-Control + ETag so caches
    // update their stored headers even when body is unchanged.
    expect(second.headers()["etag"]).toBe(etag);
    expect(second.headers()["cache-control"]).toMatch(/max-age=/);
  });

  test("Scenario 9: If-None-Match mismatch gets the full 200 response", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API_URL}/api/tags`, {
      headers: { "If-None-Match": '"stale-etag-that-does-not-match"' },
    });
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.length).toBeGreaterThan(0);
  });
});
