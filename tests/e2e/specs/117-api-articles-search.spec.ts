import { expect, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #117 API side: GET /api/articles?q=...
// Search matches title OR description case-insensitively; composes
// with tag/author/favorited via AND; bounded to 2-100 chars.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #117 — API article search (?q=)", () => {
  test("Scenario 1: q matches title OR description case-insensitively", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    // Seeds: one matches via title, one via description, one doesn't
    // match at all. Spec-unique id suffix so parallel specs don't
    // leak into the result.
    const needle = `Needle-${id}`;
    const titleSlug = await api.createArticleReturnSlug({
      title: `${needle} in the title`,
    });
    const descSlug = await api.createArticleReturnSlug({
      title: `Unrelated title ${id}`,
      description: `but ${needle} is in the description`,
    });
    await api.createArticleReturnSlug({
      title: `Miss ${id}`,
      description: "nothing relevant",
    });

    // `q` with different case than the seed — we use the whole
    // needle lowercased to verify ILIKE behaviour.
    const body = await api.listArticles({ q: needle.toLowerCase() });
    const slugs = body.articles.map((a) => a.slug);
    expect(slugs).toContain(titleSlug);
    expect(slugs).toContain(descSlug);
    // Count reflects matches — at least 2 (more possible if other
    // specs seeded a matching `Needle-<theirId>`, but our id filter
    // keeps those apart).
    const matchingOurs = body.articles.filter(
      (a) => a.slug === titleSlug || a.slug === descSlug,
    );
    expect(matchingOurs.length).toBe(2);
  });

  test("Scenario 2: q composes with tag via AND", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    const needle = `compose-${id}`;
    const tag = `only-${id}`;
    const tagged = await api.createArticleReturnSlug({
      title: `${needle} tagged`,
      tagList: [tag],
    });
    await api.createArticleReturnSlug({ title: `${needle} untagged` });
    await api.createArticleReturnSlug({
      title: `other ${id}`,
      tagList: [tag],
    });

    const body = await api.listArticles({ q: needle, tag });
    const slugs = body.articles.map((a) => a.slug);
    expect(slugs).toEqual([tagged]);
    expect(body.articlesCount).toBe(1);
  });

  test("Scenario 3: articlesCount reflects the filtered total", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    // Use the unique id as the needle directly so other specs'
    // seeds can't cross-pollute the count. The id is a timestamp +
    // random suffix, guaranteed-disjoint across specs.
    const needle = id;
    for (let i = 0; i < 7; i++) {
      await api.createArticleReturnSlug({ title: `needle-${needle}-${i}` });
    }
    // Seed a couple that don't match — they must not count.
    await api.createArticleReturnSlug({ title: `unrelated-run` });

    const body = await api.listArticles({ q: needle, limit: 5 });
    expect(body.articles.length).toBe(5); // page slice
    expect(body.articlesCount).toBe(7); // total match
  });

  test("Scenario 4: 1-char q rejected with 422; 100-char limit honoured", async () => {
    // Use raw request — the POP wrappers assume 200. The raw API
    // request context is on the underlying api field.
    const api = await ArticlesApi.newContext();
    const short = await api.api.get("/api/articles?q=a");
    expect(short.status()).toBe(422);
    const shortBody = (await short.json()) as {
      errors: Record<string, string[]>;
    };
    const shortMsg = Object.values(shortBody.errors).flat().join(" ");
    expect(shortMsg.toLowerCase()).toContain("at least 2");

    const long = "x".repeat(101);
    const tooLong = await api.api.get(
      `/api/articles?q=${encodeURIComponent(long)}`,
    );
    expect(tooLong.status()).toBe(422);
    const longBody = (await tooLong.json()) as {
      errors: Record<string, string[]>;
    };
    const longMsg = Object.values(longBody.errors).flat().join(" ");
    expect(longMsg.toLowerCase()).toContain("at most 100");
  });

  test("Scenario 5: absent q returns unfiltered result (back-compat)", async () => {
    // Ensures adding the optional param didn't regress the existing
    // /api/articles path. A bare GET should still work.
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    await api.createArticleReturnSlug({ title: `no-q ${id}` });

    const body = await api.listArticles({ author: jake });
    expect(body.articlesCount).toBeGreaterThanOrEqual(1);
    expect(body.articles.some((a) => a.title === `no-q ${id}`)).toBe(true);

    // Also a no-filter call (sanity).
    const anon = await ArticlesApi.newContext();
    const unfiltered = await anon.api.get("/api/articles");
    expect(unfiltered.status()).toBe(200);
  });
});

// Keep the API_URL reference stable for editor tooling.
void API_URL;
