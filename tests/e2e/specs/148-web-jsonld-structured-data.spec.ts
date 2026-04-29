import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";
import { runAxe } from "../axe-config";

// BDD coverage for issue #148 — schema.org JSON-LD structured
// data on article / profile / homepage. Parses each page's
// `<script type="application/ld+json">` blocks, asserts the
// required shape, plus the XSS-injection resilience check.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Parse every JSON-LD script blob on the page. Returns an array of
// parsed objects; most pages have a single blob but the homepage
// could add more in the future.
const readJsonLd = async (
  page: import("@playwright/test").Page,
): Promise<unknown[]> => {
  const raw = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return raw.map((s) => JSON.parse(s));
};

test.describe("issue #148 — JSON-LD structured data", () => {
  test("Scenario 1: article page emits Article JSON-LD with required properties", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `ld-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const article = await api.createArticle({
      title: `JSON-LD article ${id}`,
      description: "Structured data coverage article",
    });

    await page.goto(`${WEB_URL}/article/${article.slug}`);
    const blobs = await readJsonLd(page);
    expect(blobs.length).toBeGreaterThan(0);

    const articleBlob = blobs.find(
      (b) => (b as Record<string, unknown>)["@type"] === "Article",
    ) as Record<string, unknown> | undefined;
    expect(articleBlob).toBeTruthy();
    expect(articleBlob?.["@context"]).toBe("https://schema.org");
    expect(articleBlob?.headline).toBe(`JSON-LD article ${id}`);
    expect(articleBlob?.description).toBe("Structured data coverage article");
    expect(typeof articleBlob?.datePublished).toBe("string");
    expect(typeof articleBlob?.dateModified).toBe("string");
    // author is a nested Person
    const author = articleBlob?.author as Record<string, unknown> | undefined;
    expect(author?.["@type"]).toBe("Person");
    expect(author?.name).toBe(jake);
    expect(String(author?.url ?? "")).toMatch(/\/profile\/ld-/);
    // publisher is an Organization
    const publisher = articleBlob?.publisher as
      | Record<string, unknown>
      | undefined;
    expect(publisher?.["@type"]).toBe("Organization");
    expect(publisher?.name).toBe("Conduit");
  });

  test("Scenario 2: profile page emits Person JSON-LD", async ({ page }) => {
    const id = uniq();
    const jake = `ld-p-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    await page.goto(`${WEB_URL}/profile/${jake}`);
    const blobs = await readJsonLd(page);
    const personBlob = blobs.find(
      (b) => (b as Record<string, unknown>)["@type"] === "Person",
    ) as Record<string, unknown> | undefined;
    expect(personBlob).toBeTruthy();
    expect(personBlob?.name).toBe(jake);
    expect(String(personBlob?.url ?? "")).toMatch(/\/profile\/ld-p-/);
  });

  test("Scenario 3: homepage emits WebSite + SearchAction JSON-LD", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/`);
    const blobs = await readJsonLd(page);
    const siteBlob = blobs.find(
      (b) => (b as Record<string, unknown>)["@type"] === "WebSite",
    ) as Record<string, unknown> | undefined;
    expect(siteBlob).toBeTruthy();
    expect(siteBlob?.name).toBe("Conduit");
    const action = siteBlob?.potentialAction as
      | Record<string, unknown>
      | undefined;
    expect(action?.["@type"]).toBe("SearchAction");
    const target = action?.target as Record<string, unknown> | undefined;
    expect(String(target?.urlTemplate ?? "")).toMatch(
      /\?q=\{search_term_string\}$/,
    );
  });

  test("Scenario 4: </script> inside a title is escaped — no script-tag breakout", async ({
    page,
  }) => {
    // Seed an article whose title contains a literal `</script>`
    // followed by attacker-controlled script payload. If the
    // JsonLd sanitize step works, the rendered HTML contains the
    // escaped form `<\/script>` and no extra script element gets
    // injected into the DOM.
    const id = uniq();
    const jake = `ld-xss-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const malicious = `</script><script data-testid="xss-attempt">window.__xss=true;</script>pwned-${id}`;
    const article = await api.createArticle({
      title: malicious,
      description: "safe desc",
    });

    // Surface any JS console errors that might accompany a
    // breakout so we'd notice if the page did something odd.
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(`${WEB_URL}/article/${article.slug}`);

    // The injected <script> element must NOT have run. If it had,
    // `window.__xss` would be set to true.
    const xssRan = await page.evaluate(
      () => (window as unknown as { __xss?: boolean }).__xss === true,
    );
    expect(xssRan).toBe(false);

    // The data-testid the attacker picked must NOT appear as a
    // real DOM element (the literal string may appear inside the
    // JSON-LD script's text content, but no live script element
    // should match).
    const xssScriptCount = await page
      .locator('script[data-testid="xss-attempt"]')
      .count();
    expect(xssScriptCount).toBe(0);

    // The JSON-LD blob's headline should round-trip the malicious
    // title back through JSON.parse — no double-encoding, no data
    // loss, no breakout.
    const blobs = await readJsonLd(page);
    const articleBlob = blobs.find(
      (b) => (b as Record<string, unknown>)["@type"] === "Article",
    ) as Record<string, unknown> | undefined;
    expect(articleBlob?.headline).toBe(malicious);

    expect(consoleErrors).toEqual([]);
  });

  test("Scenario 5: JSON-LD uses absolute canonical URLs", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `ld-url-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const article = await api.createArticle({ title: `url-${id}` });

    await page.goto(`${WEB_URL}/article/${article.slug}`);
    const blobs = await readJsonLd(page);
    const articleBlob = blobs.find(
      (b) => (b as Record<string, unknown>)["@type"] === "Article",
    ) as Record<string, unknown> | undefined;
    expect(articleBlob).toBeTruthy();

    // Every URL property we emit must start with http — no bare
    // paths, no protocol-relative.
    const author = articleBlob?.author as Record<string, unknown> | undefined;
    expect(String(author?.url ?? "")).toMatch(/^https?:\/\//);
    expect(String(articleBlob?.mainEntityOfPage ?? "")).toMatch(
      /^https?:\/\//,
    );
  });

  test("Scenario 6: axe a11y gate on pages with JSON-LD", async ({ page }) => {
    // JSON-LD has no visible surface; confirm we didn't regress
    // the page-level axe score on the article-detail surface that
    // gained the new script element.
    const id = uniq();
    const jake = `ld-a-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const article = await api.createArticle({ title: `axe-${id}` });

    await page.goto(`${WEB_URL}/article/${article.slug}`);
    await expect(page.locator(".article-page")).toBeVisible();
    // Also probe via request to verify the ld+json script is
    // content-type text (axe shouldn't look at non-visible
    // content). This is belt-and-braces.
    const ctx = await request.newContext();
    const res = await ctx.get(`${WEB_URL}/article/${article.slug}`);
    expect(res.status()).toBe(200);
    await runAxe(page);
  });
});
