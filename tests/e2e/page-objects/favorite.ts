import { expect, request, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// POP module for the favorite surface — covers two shapes:
//
//   1. `FavoritesApi` (API-client) — wraps POST/DELETE
//      /api/articles/:slug/favorite + baseline GET. Shape matches
//      CommentsApi / ArticlesApi (see #96, #97).
//
//   2. `FavoriteButton` (component POP) — a thin wrapper around a
//      single `[data-testid=favorite-button]` inside a preview card
//      or article header. Used by spec 56 for the homepage toggle UX.
//
// #99 (Phase 2 of #35). Adapted from
// `mutoe/vue3-realworld-example-app @ dd34ba90` (MIT). Vue → Next/
// React port: favorite triggers a Next Server Action that flows
// through the API; the component POP owns the optimistic-flip +
// aria-pressed / aria-busy / data-errored interaction contract.

const DEFAULT_API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

export type ArticleFavoriteFields = {
  slug: string;
  favorited: boolean;
  favoritesCount: number;
};

export class FavoritesApi {
  constructor(
    public readonly api: APIRequestContext,
    private readonly baseURL: string = DEFAULT_API_URL,
  ) {}

  static async newContext(baseURL = DEFAULT_API_URL): Promise<FavoritesApi> {
    const ctx = await request.newContext({ baseURL });
    return new FavoritesApi(ctx, baseURL);
  }

  // ─── Seed helpers (user + article) ───────────────────────────

  async registerUser(username: string): Promise<string> {
    const res = await this.api.post("/api/users", {
      data: {
        user: {
          username,
          email: `${username}@jake.jake`,
          password: "jakejake",
        },
      },
    });
    expect(res.status()).toBe(201);
    const setCookie = res.headers()["set-cookie"] ?? "";
    const match = setCookie.match(/conduit_session=([^;]+)/);
    if (!match) {
      throw new Error("expected conduit_session cookie from register");
    }
    return match[1];
  }

  async createArticle(title: string): Promise<string> {
    const res = await this.api.post("/api/articles", {
      data: { article: { title, description: "d", body: "b" } },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { article: { slug: string } };
    return body.article.slug;
  }

  // ─── Favorite / unfavorite ───────────────────────────────────

  async favorite(slug: string): Promise<ArticleFavoriteFields> {
    const res = await this.api.post(`/api/articles/${slug}/favorite`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: ArticleFavoriteFields };
    return body.article;
  }

  async unfavorite(slug: string): Promise<ArticleFavoriteFields> {
    const res = await this.api.delete(`/api/articles/${slug}/favorite`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: ArticleFavoriteFields };
    return body.article;
  }

  async readBySlug(slug: string): Promise<ArticleFavoriteFields> {
    const res = await this.api.get(`/api/articles/${slug}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: ArticleFavoriteFields };
    return body.article;
  }

  // Raw escape hatches for error-path scenarios (401/404).
  rawFavorite(slug: string) {
    return this.api.post(`/api/articles/${slug}/favorite`);
  }

  rawUnfavorite(slug: string) {
    return this.api.delete(`/api/articles/${slug}/favorite`);
  }

  async deleteArticle(slug: string): Promise<void> {
    const res = await this.api.delete(`/api/articles/${slug}`);
    expect(res.status()).toBe(204);
  }
}

// Component POP for the FavoriteButton rendered inside an article
// preview card or article header. Takes a `Locator` for the enclosing
// card so the same button class composes with homepage (multiple
// cards) and article-detail (single header) surfaces.
export class FavoriteButton {
  constructor(private readonly button: Locator) {}

  static inCard(page: Page, slug: string): FavoriteButton {
    const card = page.locator(
      `.article-preview:has(a[href="/article/${slug}"])`,
    );
    return new FavoriteButton(card.getByTestId("favorite-button"));
  }

  get locator(): Locator {
    return this.button;
  }

  async click(): Promise<void> {
    await this.button.click();
  }

  async expectPressed(pressed: boolean): Promise<void> {
    await expect(this.button).toHaveAttribute(
      "aria-pressed",
      pressed ? "true" : "false",
    );
  }

  async expectCount(count: number | string): Promise<void> {
    await expect(this.button).toContainText(String(count));
  }

  // Wait for the server-action transition to finish so subsequent
  // independent-fetch assertions observe the committed DB state,
  // not the pre-commit optimistic state. See spec 56's #89 note.
  async expectTransitionSettled(): Promise<void> {
    await expect(this.button).not.toHaveAttribute("aria-busy", "true");
  }

  async expectErrored(timeout = 2000): Promise<void> {
    await expect(this.button).toHaveAttribute("data-errored", "true", {
      timeout,
    });
  }
}
