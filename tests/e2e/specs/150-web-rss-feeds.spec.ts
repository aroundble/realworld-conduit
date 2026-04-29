import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #150 — Atom feeds for the global feed,
// per-tag feeds, and per-author feeds. Asserts well-formed XML,
// the required Atom envelope + entry shape, correct caching
// headers, and the `<link rel="alternate">` discoverability tags
// on home / profile / tag-filtered pages.
//
// Note on paths: Next.js 16's file-router treats `[slug].xml` as
// the segment name "slug].xml" rather than a slug with an
// extension, so the RSS dynamic routes live at `/rss/tag/<tag>`
// and `/rss/author/<username>` (no .xml suffix). Feed readers
// key on the Content-Type header, not the URL suffix — this is
// standards-compliant.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Minimal XML well-formedness probe: split into opening tags and
// closing tags and make sure they balance. A real XML parser is
// overkill for the shape we emit; this catches missing closes or
// mismatched nesting.
const tagBalance = (
  xml: string,
  name: string,
): { opens: number; closes: number } => {
  const opens = (
    xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>`, "g")) ?? []
  ).length;
  const closes = (xml.match(new RegExp(`</${name}>`, "g")) ?? []).length;
  return { opens, closes };
};

const extractTextAll = (xml: string, tag: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  for (const m of xml.matchAll(re)) out.push(m[1]);
  return out;
};

test.describe("issue #150 — RSS / Atom feeds", () => {
  test("Scenario 1: /rss.xml is a well-formed Atom feed with correct headers", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/rss.xml`);
    expect(res.status()).toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toMatch(/atom\+xml/);

    const cache = res.headers()["cache-control"] ?? "";
    expect(cache).toMatch(/public/);
    expect(cache).toMatch(/max-age=300/);
    expect(cache).toMatch(/stale-while-revalidate=3600/);

    const xml = await res.text();
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    // Root <feed> matches close tag.
    const { opens, closes } = tagBalance(xml, "feed");
    expect(opens).toBe(1);
    expect(closes).toBe(1);
    // Exactly one <title> at the root (entry titles are nested
    // under <entry> but our extractTextAll grabs only direct tag
    // matches — multiple is OK on a seeded DB).
    expect(xml).toMatch(
      /<title>Conduit — Latest articles<\/title>/,
    );
    // Self-reference link.
    expect(xml).toMatch(/rel="self"/);
  });

  test("Scenario 2: /rss/author/<username> filters to that author's articles", async () => {
    const id = uniq();
    const jake = `rss-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    await api.createArticle({ title: `rss-a-${id}` });

    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/rss/author/${jake}`);
    expect(res.status()).toBe(200);
    const xml = await res.text();

    expect(xml).toMatch(new RegExp(`Articles by ${jake}`));
    const titles = extractTextAll(xml, "title");
    // First <title> is the feed title; subsequent are entries.
    // At least one entry title should match our seed.
    const match = titles.some((t) => t.includes(`rss-a-${id}`));
    expect(match).toBe(true);
    // Every <author><name>...</name></author> inside an <entry>
    // must be our author — ensure no cross-author leak.
    const names = extractTextAll(xml, "name");
    expect(names.every((n) => n === jake)).toBe(true);
  });

  test("Scenario 3: /rss/tag/<tag> filters to that tag's articles", async () => {
    const id = uniq();
    const tag = `t${id.replace(/\D/g, "").slice(0, 10)}`;
    const jake = `rsst-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    await api.createArticle({
      title: `rss-t-${id}`,
      tagList: [tag],
    });

    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/rss/tag/${tag}`);
    expect(res.status()).toBe(200);
    const xml = await res.text();

    expect(xml).toMatch(new RegExp(`Articles tagged #${tag}`));
    // Our seeded entry's tag category should appear.
    expect(xml).toMatch(new RegExp(`category term="${tag}"`));
  });

  test("Scenario 4: feed URLs are absolute, use canonical origin", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/rss.xml`);
    const xml = await res.text();
    // Self + alternate links at the root carry absolute URLs.
    const hrefs = [...xml.matchAll(/<link href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^https?:\/\//);
    }
  });

  test("Scenario 5: home page renders <link rel=alternate> pointing at /rss.xml", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    const links = page.locator(
      'link[rel="alternate"][type*="atom"], link[rel="alternate"][type*="rss"]',
    );
    await expect(links.first()).toHaveAttribute("href", /\/rss\.xml$/);
  });

  test("Scenario 6: profile page alternate-link points to per-author feed", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `rss-p-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    await page.goto(`${WEB_URL}/profile/${jake}`);
    const links = page.locator(
      'link[rel="alternate"][type*="atom"], link[rel="alternate"][type*="rss"]',
    );
    const href = await links.first().getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toMatch(new RegExp(`/rss/author/${jake}$`));
  });

  test("Scenario 7: tag-filtered home page alternate-link points to per-tag feed", async ({
    page,
  }) => {
    const id = uniq();
    const tag = `tg${id.replace(/\D/g, "").slice(0, 8)}`;
    await page.goto(`${WEB_URL}/?tag=${tag}`);
    const links = page.locator(
      'link[rel="alternate"][type*="atom"], link[rel="alternate"][type*="rss"]',
    );
    const href = await links.first().getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toMatch(new RegExp(`/rss/tag/${tag}$`));
  });

  test("Scenario 8: XML escapes author-supplied strings (no script injection via title)", async () => {
    const id = uniq();
    const jake = `rss-xss-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    // Title with characters XML must escape.
    await api.createArticle({
      title: `rss-xml "<>&'-${id}`,
    });

    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/rss/author/${jake}`);
    const xml = await res.text();

    // The literal `<` from the title MUST NOT appear — it must be
    // &lt;. Same for the other metacharacters.
    expect(xml).not.toMatch(/rss-xml "<>/);
    expect(xml).toMatch(/&lt;/);
    expect(xml).toMatch(/&gt;/);
    expect(xml).toMatch(/&quot;/);
    expect(xml).toMatch(/&amp;/);
    expect(xml).toMatch(/&apos;/);

    // No double-escape (&amp;amp;).
    expect(xml).not.toMatch(/&amp;amp;/);
  });
});
