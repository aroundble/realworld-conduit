import { expect, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #113: dynamic OG + Twitter metadata on the
// article + profile pages. The crawler experience is what we're
// testing — asserts on rendered <head> tags, not on interactive
// behaviour, so no fixture auth needed.

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Read a meta tag's content attribute by selector. Returns `null` when
// the tag is absent — lets Scenario 4 assert absence directly.
const readMeta = async (
  page: import("@playwright/test").Page,
  selector: string,
): Promise<string | null> => {
  const tag = page.locator(selector);
  if ((await tag.count()) === 0) return null;
  return tag.getAttribute("content");
};

test.describe("issue #113 — dynamic OG + Twitter metadata", () => {
  test("Scenario 1+2: article page emits dynamic title + OG + Twitter", async ({
    page,
  }) => {
    const id = uniq();
    const api = await ArticlesApi.newContext();
    const jake = `jake-${id}`;
    await api.registerUser(jake);
    const article = await api.createArticle({
      title: `Structural editing ${id}`,
      description: "A pattern for working with AST-shaped data",
      body: "Body text",
    });

    await page.goto(`${WEB_URL}/article/${article.slug}`);

    // Scenario 1: title + description computed from the article.
    await expect(page).toHaveTitle(`Structural editing ${id} — Conduit`);
    expect(await readMeta(page, 'meta[name="description"]')).toBe(
      "A pattern for working with AST-shaped data",
    );

    // Scenario 2: OG + Twitter tags.
    expect(await readMeta(page, 'meta[property="og:title"]')).toBe(
      `Structural editing ${id}`,
    );
    expect(await readMeta(page, 'meta[property="og:description"]')).toBe(
      "A pattern for working with AST-shaped data",
    );
    expect(await readMeta(page, 'meta[property="og:type"]')).toBe("article");

    const ogUrl = await readMeta(page, 'meta[property="og:url"]');
    expect(ogUrl).toBeTruthy();
    expect(ogUrl).toContain(`/article/${article.slug}`);

    expect(await readMeta(page, 'meta[name="twitter:card"]')).toBe("summary");
  });

  test("Scenario 3: profile page emits dynamic title + og:type=profile", async ({
    page,
  }) => {
    const id = uniq();
    const api = await ArticlesApi.newContext();
    const jake = `jake-${id}`;
    await api.registerUser(jake);

    await page.goto(`${WEB_URL}/profile/${jake}`);

    await expect(page).toHaveTitle(`${jake} — Conduit`);

    // Fresh user has null bio → fallback copy.
    const description = await readMeta(page, 'meta[name="description"]');
    expect(description).toBe(`View ${jake}'s articles on Conduit`);

    expect(await readMeta(page, 'meta[property="og:type"]')).toBe("profile");
    expect(await readMeta(page, 'meta[property="og:title"]')).toBe(jake);

    const ogUrl = await readMeta(page, 'meta[property="og:url"]');
    expect(ogUrl).toBeTruthy();
    expect(ogUrl).toContain(`/profile/${jake}`);
  });

  test("Scenario 4: 404 article page does not emit og:type=article", async ({
    page,
  }) => {
    // A slug no article can have — the generateMetadata path returns
    // the generic title, then notFound() renders the 404 boundary.
    const res = await page.goto(`${WEB_URL}/article/no-such-slug-${uniq()}`);
    expect(res?.status()).toBe(404);

    // Title is the generic 404 copy — neither the stale slug nor a
    // previous article's title should leak through.
    const title = await page.title();
    expect(title).toContain("not found");
    expect(title).not.toContain("Structural editing");

    // og:type=article absent. A previewer that does index this URL
    // should treat it as a plain page, not an article.
    const ogType = await readMeta(page, 'meta[property="og:type"]');
    expect(ogType).not.toBe("article");
  });
});
