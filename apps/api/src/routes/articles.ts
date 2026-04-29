import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";
import { config } from "../config.js";
import {
  ArticleError,
  createArticle,
  deleteArticle,
  favoriteArticle,
  getArticleBySlug,
  listArticles,
  unfavoriteArticle,
  updateArticle,
} from "../services/articles.service.js";
import { optionalAuth, requireAuth, type UserVars } from "../middleware/jwt-cookie.js";
import { ErrorResponseSchema } from "../schemas/user.js";
import {
  ArticleListResponseSchema,
  ArticleResponseSchema,
  CreateArticleRequestSchema,
  UpdateArticleRequestSchema,
} from "../schemas/article.js";

type ArticleVars = AppEnv["Variables"] & UserVars;
type ArticleEnv = { Variables: ArticleVars };

const SlugParam = z
  .object({
    slug: z.string().min(1).openapi({ param: { name: "slug", in: "path" } }),
  })
  .openapi("SlugParam");

const jsonError = (field: string, detail: string) => ({
  errors: { [field]: [detail] },
});

// Query-param schema for list + filter. `z.coerce.number()` accepts the
// string shape URLSearchParams produces; the outer `.max(...)` threshold
// comes from config so ops can adjust per-env without a redeploy.
// Field-level messages here match the AC's "must be at most 100"
// expectation via the spec422Hook (which emits { errors: { limit: [...] } }).
const ListArticlesQuery = z
  .object({
    tag: z.string().optional(),
    author: z.string().optional(),
    favorited: z.string().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, "must be at least 1")
      .max(config.articleListMaxLimit, `must be at most ${config.articleListMaxLimit}`)
      .optional(),
    offset: z.coerce
      .number()
      .int()
      .min(0, "must be at least 0")
      .optional(),
  })
  .openapi("ListArticlesQuery");

const listArticlesRoute = createRoute({
  method: "get",
  path: "/api/articles",
  tags: ["articles"],
  summary: "List articles with optional filters + pagination",
  request: { query: ListArticlesQuery },
  responses: {
    200: {
      description: "Articles + total count",
      content: { "application/json": { schema: ArticleListResponseSchema } },
    },
    422: {
      description: "Unprocessable entity",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const createArticleRoute = createRoute({
  method: "post",
  path: "/api/articles",
  tags: ["articles"],
  summary: "Create a new article",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateArticleRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: ArticleResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    422: {
      description: "Unprocessable entity",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const getArticleRoute = createRoute({
  method: "get",
  path: "/api/articles/{slug}",
  tags: ["articles"],
  summary: "Fetch an article by slug",
  request: { params: SlugParam },
  responses: {
    200: {
      description: "Article",
      content: { "application/json": { schema: ArticleResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const updateArticleRoute = createRoute({
  method: "put",
  path: "/api/articles/{slug}",
  tags: ["articles"],
  summary: "Update an article (author-scoped)",
  request: {
    params: SlugParam,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateArticleRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: ArticleResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Forbidden — viewer is not the author",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    422: {
      description: "Unprocessable entity",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const deleteArticleRoute = createRoute({
  method: "delete",
  path: "/api/articles/{slug}",
  tags: ["articles"],
  summary: "Delete an article (author-scoped)",
  request: { params: SlugParam },
  responses: {
    204: { description: "Deleted" },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Forbidden — viewer is not the author",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const favoriteRoute = createRoute({
  method: "post",
  path: "/api/articles/{slug}/favorite",
  tags: ["articles"],
  summary: "Favorite an article",
  request: { params: SlugParam },
  responses: {
    200: {
      description: "Favorited (or already favorited — idempotent)",
      content: { "application/json": { schema: ArticleResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const unfavoriteRoute = createRoute({
  method: "delete",
  path: "/api/articles/{slug}/favorite",
  tags: ["articles"],
  summary: "Unfavorite an article",
  request: { params: SlugParam },
  responses: {
    200: {
      description: "Unfavorited (or was never favorited — idempotent)",
      content: { "application/json": { schema: ArticleResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const registerArticleRoutes = (app: OpenAPIHono<AppEnv>): void => {
  const authed = app as unknown as OpenAPIHono<ArticleEnv>;

  // GET /api/articles (list) and POST /api/articles (create) share the
  // same path, and Hono's `app.use(path, mw)` is method-agnostic —
  // mounting `requireAuth()` on the shared path would 401 anonymous
  // GETs. Use `optionalAuth()` here (serves both), and the POST
  // handler enforces auth via its own `if (!viewer) → 401` check.
  // Same pattern used by the shared `/api/articles/{slug}` surface.
  authed.use(listArticlesRoute.getRoutingPath(), optionalAuth());
  authed.openapi(listArticlesRoute, async (c) => {
    const viewer = c.get("user");
    const q = c.req.valid("query");
    const limit = q.limit ?? config.articleListDefaultLimit;
    const offset = q.offset ?? 0;
    const result = await listArticles(
      {
        tag: q.tag,
        author: q.author,
        favoritedBy: q.favorited,
        limit,
        offset,
      },
      viewer?.id ?? null,
    );
    return c.json(result, 200);
  });

  authed.openapi(createArticleRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("auth", "Unauthorized"), 401);
    const { article } = c.req.valid("json");
    try {
      const envelope = await createArticle(viewer.id, article);
      return c.json({ article: envelope }, 201);
    } catch (err) {
      if (err instanceof ArticleError && err.status === 422) {
        return c.json(jsonError(err.field, err.detail), 422);
      }
      throw err;
    }
  });

  authed.use(getArticleRoute.getRoutingPath(), optionalAuth());
  authed.openapi(getArticleRoute, async (c) => {
    const viewer = c.get("user");
    const { slug } = c.req.valid("param");
    try {
      const envelope = await getArticleBySlug(slug, viewer?.id ?? null);
      return c.json({ article: envelope }, 200);
    } catch (err) {
      if (err instanceof ArticleError && err.status === 404) {
        return c.json(jsonError(err.field, err.detail), 404);
      }
      throw err;
    }
  });

  // PUT + DELETE share the `/api/articles/{slug}` path with GET above,
  // and Hono's `app.use(path, ...)` is method-agnostic — adding a
  // `requireAuth()` .use() here would stack on top of the `optionalAuth()`
  // above and 401 anonymous GETs. Instead the handlers do an explicit
  // `if (!viewer) → 401` check, which yields the same contract
  // (anonymous PUT/DELETE fail 401) without breaking anonymous reads.
  authed.openapi(updateArticleRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("auth", "Unauthorized"), 401);
    const { slug } = c.req.valid("param");
    const { article } = c.req.valid("json");
    try {
      const envelope = await updateArticle(viewer.id, slug, article);
      return c.json({ article: envelope }, 200);
    } catch (err) {
      if (err instanceof ArticleError) {
        if (err.status === 404) return c.json(jsonError(err.field, err.detail), 404);
        if (err.status === 403) return c.json(jsonError(err.field, err.detail), 403);
        if (err.status === 422) return c.json(jsonError(err.field, err.detail), 422);
      }
      throw err;
    }
  });

  authed.openapi(deleteArticleRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("auth", "Unauthorized"), 401);
    const { slug } = c.req.valid("param");
    try {
      await deleteArticle(viewer.id, slug);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof ArticleError) {
        if (err.status === 404) return c.json(jsonError(err.field, err.detail), 404);
        if (err.status === 403) return c.json(jsonError(err.field, err.detail), 403);
      }
      throw err;
    }
  });

  // Favorite + unfavorite share `/api/articles/{slug}/favorite`; the
  // shared path is disjoint from the `/api/articles/{slug}` surface
  // that `optionalAuth()` already covers, so mounting `requireAuth()`
  // here is safe — it only affects POST + DELETE on this sub-path.
  authed.use(favoriteRoute.getRoutingPath(), requireAuth());
  authed.openapi(favoriteRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("auth", "Unauthorized"), 401);
    const { slug } = c.req.valid("param");
    try {
      const envelope = await favoriteArticle(viewer.id, slug);
      return c.json({ article: envelope }, 200);
    } catch (err) {
      if (err instanceof ArticleError && err.status === 404) {
        return c.json(jsonError(err.field, err.detail), 404);
      }
      throw err;
    }
  });

  authed.openapi(unfavoriteRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("auth", "Unauthorized"), 401);
    const { slug } = c.req.valid("param");
    try {
      const envelope = await unfavoriteArticle(viewer.id, slug);
      return c.json({ article: envelope }, 200);
    } catch (err) {
      if (err instanceof ArticleError && err.status === 404) {
        return c.json(jsonError(err.field, err.detail), 404);
      }
      throw err;
    }
  });
};
