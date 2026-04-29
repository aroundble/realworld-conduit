import { expect, test } from "@playwright/test";
import { FavoritesApi } from "../page-objects/favorite";

// BDD coverage for issue #12: POST + DELETE /api/articles/:slug/favorite.
// Six of the seven AC scenarios run here; scenario 5 ("other article
// envelopes reflect real favorite data") touches the list endpoint
// (GET /api/articles) which ships in #10. The detail-endpoint half of
// the integration (POST favorite → subsequent GET /:slug envelope
// carries real favorited/favoritesCount) is exercised throughout.
// When #10 merges its own spec can assert the list-envelope half with
// one extra seed; no changes needed here.
//
// #99 Phase 2 refactor: API helpers via `FavoritesApi`. Scenarios 6
// (anon 401) + 7 (non-existent slug 404) use `rawFavorite`/
// `rawUnfavorite` — the POP's wrappers assert 200.

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #12 — API favorite / unfavorite article", () => {
  test("Scenario 1: first favorite flips count 0 → 1 and favorited true", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Favorite me ${id}`);

    // Baseline: envelope reports 0 + false pre-favorite.
    const before = await danApi.readBySlug(slug);
    expect(before.favoritesCount).toBe(0);
    expect(before.favorited).toBe(false);

    const fav = await danApi.favorite(slug);
    expect(fav.favoritesCount).toBe(1);
    expect(fav.favorited).toBe(true);
  });

  test("Scenario 2: favoriting twice is idempotent — count stays 1", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Idempotent ${id}`);

    await danApi.favorite(slug);
    const second = await danApi.favorite(slug);
    expect(second.favoritesCount).toBe(1);
    expect(second.favorited).toBe(true);
  });

  test("Scenario 3: unfavorite flips count 1 → 0 and favorited false", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Unfavorite ${id}`);

    await danApi.favorite(slug);
    const un = await danApi.unfavorite(slug);
    expect(un.favoritesCount).toBe(0);
    expect(un.favorited).toBe(false);
  });

  test("Scenario 4: favoritesCount reflects multiple users", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const alice = `alice-${id}`;
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    const aliceApi = await FavoritesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    await aliceApi.registerUser(alice);
    const slug = await jakeApi.createArticle(`Multi-fav ${id}`);

    await danApi.favorite(slug);
    await aliceApi.favorite(slug);

    const anon = await FavoritesApi.newContext();
    const article = await anon.readBySlug(slug);
    expect(article.favoritesCount).toBe(2);
    // Anonymous viewer sees favorited=false regardless of other users'
    // state — `favorited` is strictly viewer-relative.
    expect(article.favorited).toBe(false);
  });

  test("Scenario 5 (detail-endpoint half): viewer-relative favorited is per-user", async () => {
    // The list-endpoint half (GET /api/articles) lands with #10. This
    // spec covers the same invariant against GET /api/articles/:slug:
    // when dan has favorited but alice hasn't, fetching the same slug
    // with each viewer's cookie returns different `favorited` flags.
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const alice = `alice-${id}`;
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    const aliceApi = await FavoritesApi.newContext();
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);
    await aliceApi.registerUser(alice);
    const slug = await jakeApi.createArticle(`Per-viewer ${id}`);

    await danApi.favorite(slug);

    const danView = await danApi.readBySlug(slug);
    expect(danView.favorited).toBe(true);
    expect(danView.favoritesCount).toBe(1);

    const aliceView = await aliceApi.readBySlug(slug);
    expect(aliceView.favorited).toBe(false);
    expect(aliceView.favoritesCount).toBe(1);
  });

  test("Scenario 6: favorite endpoints require auth", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await FavoritesApi.newContext();
    await jakeApi.registerUser(jake);
    const slug = await jakeApi.createArticle(`Auth-check ${id}`);

    const anon = await FavoritesApi.newContext();
    const post = await anon.rawFavorite(slug);
    expect(post.status()).toBe(401);
    const del = await anon.rawUnfavorite(slug);
    expect(del.status()).toBe(401);
  });

  test("Scenario 7: favorite non-existent article → 404", async () => {
    const id = uniq();
    const dan = `dan-${id}`;
    const danApi = await FavoritesApi.newContext();
    await danApi.registerUser(dan);

    const res = await danApi.rawFavorite(`no-such-slug-${id}`);
    expect(res.status()).toBe(404);
  });
});
