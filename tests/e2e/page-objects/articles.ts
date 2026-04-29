import { expect, request, type APIRequestContext } from "@playwright/test";

// API-client page object for `/api/articles` + friends.
//
// #96 (Phase 2 of #35). The four articles-family specs (8, 9, 10, 11)
// are API-only (Playwright `request.newContext()` → Hono API). The
// traditional browser-DOM POP pattern doesn't map, but the same
// motivation applies: semantic methods for reusable API journeys
// instead of every spec re-implementing `registerUser` +
// `createArticle` helpers locally. Previous PRs (#103 auth) kept
// API-only specs untouched; this PR consolidates the duplicated
// helpers into one module so future API specs don't keep growing
// the copy-paste surface.
//
// Adapted from mutoe/vue3-realworld-example-app @ dd34ba90 (MIT) —
// the Vue ref uses axios clients with similar semantic names
// (`createArticle`, `getArticles`, `favorite`). Our naming matches.

const DEFAULT_API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

export type Article = {
  slug: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
  createdAt: string;
  updatedAt: string;
  favorited: boolean;
  favoritesCount: number;
  author: {
    username: string;
    bio: string | null;
    image: string | null;
    following: boolean;
  };
};

export type ArticlesEnvelope = {
  articles: Article[];
  articlesCount: number;
};

export type ArticleInput = {
  title: string;
  description?: string;
  body?: string;
  tagList?: string[];
};

export type ArticleUpdate = Partial<{
  title: string;
  description: string;
  body: string;
}>;

export type ListFilters = Partial<{
  author: string;
  tag: string;
  favorited: string;
  limit: number;
  offset: number;
}>;

export class ArticlesApi {
  constructor(
    public readonly api: APIRequestContext,
    private readonly baseURL: string = DEFAULT_API_URL,
  ) {}

  static async newContext(baseURL = DEFAULT_API_URL): Promise<ArticlesApi> {
    const ctx = await request.newContext({ baseURL });
    return new ArticlesApi(ctx, baseURL);
  }

  // ─── User helpers (auth prerequisite for article ops) ────────

  async registerUser(username: string): Promise<void> {
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
  }

  // ─── Articles CRUD ───────────────────────────────────────────

  async createArticle(input: ArticleInput): Promise<Article> {
    const res = await this.api.post("/api/articles", {
      data: {
        article: {
          title: input.title,
          description: input.description ?? "d",
          body: input.body ?? "b",
          tagList: input.tagList ?? [],
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { article: Article };
    return body.article;
  }

  // Convenience: every spec under #96 historically only cares about
  // the slug after creation. Wraps `createArticle` for that shape.
  async createArticleReturnSlug(input: ArticleInput): Promise<string> {
    const article = await this.createArticle(input);
    return article.slug;
  }

  async readBySlug(slug: string): Promise<Article> {
    const res = await this.api.get(`/api/articles/${slug}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: Article };
    return body.article;
  }

  async updateArticle(slug: string, update: ArticleUpdate): Promise<Article> {
    const res = await this.api.put(`/api/articles/${slug}`, {
      data: { article: update },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: Article };
    return body.article;
  }

  async deleteArticle(slug: string): Promise<void> {
    const res = await this.api.delete(`/api/articles/${slug}`);
    expect(res.status()).toBe(204);
  }

  // ─── List + feed ─────────────────────────────────────────────

  async listArticles(filters: ListFilters = {}): Promise<ArticlesEnvelope> {
    const params = new URLSearchParams();
    if (filters.author) params.set("author", filters.author);
    if (filters.tag) params.set("tag", filters.tag);
    if (filters.favorited) params.set("favorited", filters.favorited);
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.offset !== undefined) {
      params.set("offset", String(filters.offset));
    }
    const qs = params.toString();
    const path = qs ? `/api/articles?${qs}` : "/api/articles";
    const res = await this.api.get(path);
    expect(res.status()).toBe(200);
    return (await res.json()) as ArticlesEnvelope;
  }

  async feedArticles(
    filters: Pick<ListFilters, "limit" | "offset"> = {},
  ): Promise<ArticlesEnvelope> {
    const res = await this.feedRaw(filters);
    expect(res.status()).toBe(200);
    return (await res.json()) as ArticlesEnvelope;
  }

  // Raw feed call — some scenarios need the Response object to
  // assert 401 without auth, not just the envelope.
  async feedRaw(
    filters: Pick<ListFilters, "limit" | "offset"> = {},
  ): Promise<Awaited<ReturnType<APIRequestContext["get"]>>> {
    const params = new URLSearchParams();
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.offset !== undefined) {
      params.set("offset", String(filters.offset));
    }
    const qs = params.toString();
    const path = qs ? `/api/articles/feed?${qs}` : "/api/articles/feed";
    return this.api.get(path);
  }

  // ─── Favorite / follow relationship shortcuts ────────────────

  async favorite(slug: string): Promise<Article> {
    const res = await this.api.post(`/api/articles/${slug}/favorite`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: Article };
    return body.article;
  }

  async unfavorite(slug: string): Promise<Article> {
    const res = await this.api.delete(`/api/articles/${slug}/favorite`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { article: Article };
    return body.article;
  }

  async follow(username: string): Promise<void> {
    const res = await this.api.post(`/api/profiles/${username}/follow`);
    expect(res.status()).toBe(200);
  }
}
