import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";
import {
  ArticleError,
  createArticle,
  getArticleBySlug,
} from "../services/articles.service.js";
import { optionalAuth, requireAuth, type UserVars } from "../middleware/jwt-cookie.js";
import { ErrorResponseSchema } from "../schemas/user.js";
import {
  ArticleResponseSchema,
  CreateArticleRequestSchema,
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

export const registerArticleRoutes = (app: OpenAPIHono<AppEnv>): void => {
  const authed = app as unknown as OpenAPIHono<ArticleEnv>;

  authed.use(createArticleRoute.getRoutingPath(), requireAuth());
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
};
