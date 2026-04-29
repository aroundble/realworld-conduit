import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #135 — /sitemap.xml + /robots.txt for SEO
// crawl. Sitemap is a dynamic route (Next.js metadata route); robots
// is also dynamic so the Sitemap: URL matches the deployed origin.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Minimal XML extraction — avoid pulling in a full DOM parser for a
// spec that just needs to read <loc> + <lastmod> + <priority> tags.
const extractTags = (xml: string, tag: string): string[] => {
  const pattern = new RegExp(`<${tag}>([^<]+)</${tag}>`, "g");
  const matches = xml.matchAll(pattern);
  return Array.from(matches, (m) => m[1]);
};

const firstTagIn = (block: string, tag: string): string | null => {
  const m = block.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m ? m[1] : null;
};

test.describe("issue #135 — sitemap + robots", () => {
  test("Scenario 1: /robots.txt allows crawl, disallows editor + settings + api, points to sitemap", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/robots.txt`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/text\/plain/);
    const body = await res.text();

    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Allow:\s*\//);
    expect(body).toMatch(/Disallow:\s*\/editor\b/);
    expect(body).toMatch(/Disallow:\s*\/settings\b/);
    expect(body).toMatch(/Disallow:\s*\/api\//);
    expect(body).toMatch(/Sitemap:\s*\S+\/sitemap\.xml/);
  });

  test("Scenario 2: /sitemap.xml is valid XML with homepage + article + profile entries", async () => {
    // Seed a unique article so the sitemap has at least one
    // namespaced <loc> we can detect regardless of what else is in
    // the DB from parallel spec runs.
    const id = uniq();
    const jake = `sm-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const article = await api.createArticle({ title: `sitemap-${id}` });

    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/sitemap.xml`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/xml/);
    const body = await res.text();

    // Root envelope.
    expect(body).toMatch(/^<\?xml/);
    expect(body).toMatch(/<urlset\b/);
    expect(body).toMatch(/xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);

    const locs = extractTags(body, "loc");
    // Homepage always present.
    expect(locs.some((l) => /\/$/.test(l))).toBe(true);
    // Our seeded article appears.
    expect(locs).toContain(`${WEB_URL}/article/${article.slug}`);
    // Our seeded author appears.
    expect(locs).toContain(`${WEB_URL}/profile/${jake}`);

    // Editor / settings must NEVER appear — crawlers should not be
    // pointed at authed-only routes.
    expect(locs.every((l) => !l.includes("/editor"))).toBe(true);
    expect(locs.every((l) => !l.includes("/settings"))).toBe(true);
  });

  test("Scenario 3: each <lastmod> parses as a valid ISO 8601 date", async () => {
    const id = uniq();
    const jake = `sm-lm-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    await api.createArticle({ title: `lastmod-${id}` });

    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/sitemap.xml`);
    const body = await res.text();
    const lastmods = extractTags(body, "lastmod");
    expect(lastmods.length).toBeGreaterThan(0);
    for (const v of lastmods) {
      const parsed = new Date(v);
      expect(Number.isFinite(parsed.getTime())).toBe(true);
    }
  });

  test("Scenario 4: sitemap assigns expected priorities per URL class", async () => {
    const id = uniq();
    const jake = `sm-p-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const article = await api.createArticle({ title: `pri-${id}` });

    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/sitemap.xml`);
    const body = await res.text();

    // Parse <url>…</url> blocks so we can correlate <loc> with its
    // sibling <priority>. Blocks are not nested.
    const urlBlocks = body.split(/<\/?url>/).filter((b) => b.includes("<loc>"));
    const priorityFor = (locSubstr: string): string | null => {
      const block = urlBlocks.find((b) => b.includes(locSubstr));
      return block ? firstTagIn(block, "priority") : null;
    };

    // Homepage — priority 1.0 (Next.js normalises to "1").
    // Identify the home block by looking for a <loc> that ends at "/".
    const homeBlock = urlBlocks.find((b) => /<loc>[^<]+\/<\/loc>/.test(b));
    const homePriority = homeBlock ? firstTagIn(homeBlock, "priority") : null;
    expect(["1", "1.0"]).toContain(homePriority ?? "");

    // Article — 0.8.
    const articlePriority = priorityFor(`/article/${article.slug}`);
    expect(articlePriority).toBe("0.8");

    // Profile — 0.5.
    const profilePriority = priorityFor(`/profile/${jake}`);
    expect(profilePriority).toBe("0.5");
  });
});
