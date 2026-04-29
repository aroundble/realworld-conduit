import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #126 — API request body-size limits.
//
// Two-tier cap. The global cap (API_BODY_LIMIT_GLOBAL_KB, default
// 1024) is a DoS shield on every mutating endpoint; the per-endpoint
// cap (API_BODY_LIMIT_ARTICLE_KB, default 100) layers on for article
// create/update where the legitimate payload is largest but still
// bounded. Per-field zod caps (title.max(300), body.max(50_000)) still
// surface as 422; those are business rules, not DoS shields.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Distinct synthetic IPs so this spec doesn't share rate-limit
// buckets with any other spec running nearby. Even with rate-
// limiting disabled in dev, the body-limit spec is safe to run
// alongside the rest of the suite because each newContext gets its
// own X-Forwarded-For.
const fakeIp = (id: string) =>
  `10.1.${(Number.parseInt(id.slice(-3), 10) || 0) % 250}.${(Number.parseInt(id.slice(-5, -3), 10) || 0) % 250}`;

type BodyLimitResponse = {
  status(): number;
  json(): Promise<unknown>;
};

const assertBodyLimitEnvelope = async (
  res: BodyLimitResponse,
  expectedKb: number,
) => {
  expect(res.status()).toBe(413);
  const body = (await res.json()) as { errors: Record<string, string[]> };
  expect(body.errors.body?.[0] ?? "").toBe(
    `payload too large, max ${expectedKb}KB`,
  );
};

test.describe("issue #126 — API body-size limits", () => {
  test("Scenario 1: oversized POST /api/articles body returns 413 with per-endpoint cap", async () => {
    const id = uniq();
    const jake = `bl-a-${id}`;
    const api = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": fakeIp(id),
    });
    await api.registerUser(jake);

    // Body > 500KB — well past the 100KB per-endpoint cap and also
    // past the 50KB zod cap, but body-limit runs first so zod never
    // sees it.
    const oversized = "x".repeat(600 * 1024);
    const res = await api.api.post("/api/articles", {
      data: {
        article: {
          title: `bl-${id}`,
          description: "d",
          body: oversized,
        },
      },
    });
    await assertBodyLimitEnvelope(res, 100);
  });

  test("Scenario 2: global 1MB cap fires on a non-article mutating endpoint", async () => {
    const id = uniq();
    const jake = `bl-g-${id}`;
    const api = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": fakeIp(id),
    });
    await api.registerUser(jake);

    // PUT /api/user with a 1.5 MB bio. Zod would 422 on bio.max(2000)
    // but the global cap rejects first. Article routes have the 100KB
    // cap; user-update inherits only the 1MB global.
    const giantBio = "y".repeat(1_500 * 1024);
    const res = await api.api.put("/api/user", {
      data: { user: { bio: giantBio } },
    });
    await assertBodyLimitEnvelope(res, 1024);
  });

  test("Scenario 3: per-field zod caps still produce 422 for requests under the body-size cap", async () => {
    const id = uniq();
    const jake = `bl-z-${id}`;
    const api = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": fakeIp(id),
    });
    await api.registerUser(jake);

    // 60KB body — under the 100KB per-endpoint cap, over the 50KB
    // zod cap. Must surface as 422 on `body` (too_big), not 413.
    const overZodButUnderLimit = "z".repeat(60 * 1024);
    const res = await api.api.post("/api/articles", {
      data: {
        article: {
          title: `bl-z-${id}`,
          description: "d",
          body: overZodButUnderLimit,
        },
      },
    });
    expect(res.status()).toBe(422);
    const envelope = (await res.json()) as {
      errors: Record<string, string[]>;
    };
    expect(envelope.errors.body).toBeTruthy();
    expect(envelope.errors.body?.[0] ?? "").not.toBe(
      "payload too large, max 100KB",
    );
  });

  test("Scenario 4: GET reads are unaffected — no body, no 413", async () => {
    const id = uniq();
    const api = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { "X-Forwarded-For": fakeIp(id) },
    });

    const list = await api.get("/api/articles?limit=5");
    expect(list.status()).toBe(200);

    const tags = await api.get("/api/tags");
    expect(tags.status()).toBe(200);

    const healthz = await api.get("/healthz");
    expect(healthz.status()).toBe(200);
  });

  test("Scenario 5: normal-sized writes succeed — no regression", async () => {
    const id = uniq();
    const jake = `bl-ok-${id}`;
    const api = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": fakeIp(id),
    });
    await api.registerUser(jake);

    // 40 KB body — under every cap.
    const normal = "n".repeat(40 * 1024);
    const slug = await api.createArticleReturnSlug({
      title: `bl-ok-${id}`,
      body: normal,
    });
    expect(slug).toMatch(/^bl-ok-/);

    // PUT on the same article with an equally normal-sized update.
    const upd = await api.api.put(`/api/articles/${slug}`, {
      data: { article: { body: "updated" } },
    });
    expect(upd.status()).toBe(200);
  });

  test("Scenario 6: PUT /api/articles/:slug enforces the same per-endpoint cap as POST", async () => {
    const id = uniq();
    const jake = `bl-p-${id}`;
    const api = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": fakeIp(id),
    });
    await api.registerUser(jake);

    const slug = await api.createArticleReturnSlug({ title: `bl-p-${id}` });
    const oversized = "u".repeat(600 * 1024);
    const res = await api.api.put(`/api/articles/${slug}`, {
      data: { article: { body: oversized } },
    });
    await assertBodyLimitEnvelope(res, 100);
  });
});
