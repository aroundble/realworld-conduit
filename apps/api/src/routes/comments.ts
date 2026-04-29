import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";
import {
  CommentError,
  addComment,
  deleteComment,
  listComments,
  updateComment,
} from "../services/comments.service.js";
import { optionalAuth, requireAuth, type UserVars } from "../middleware/jwt-cookie.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { ErrorResponseSchema } from "../schemas/user.js";
import {
  CommentListResponseSchema,
  CommentResponseSchema,
  CreateCommentRequestSchema,
  UpdateCommentRequestSchema,
} from "../schemas/comment.js";

type CommentVars = AppEnv["Variables"] & UserVars;
type CommentEnv = { Variables: CommentVars };

const SlugParam = z
  .object({
    slug: z.string().min(1).openapi({ param: { name: "slug", in: "path" } }),
  })
  .openapi("CommentSlugParam");

const SlugAndIdParams = z
  .object({
    slug: z.string().min(1).openapi({ param: { name: "slug", in: "path" } }),
    id: z.coerce
      .number()
      .int()
      .positive()
      .openapi({ param: { name: "id", in: "path" } }),
  })
  .openapi("CommentSlugAndIdParams");

const jsonError = (field: string, detail: string) => ({
  errors: { [field]: [detail] },
});

const listCommentsRoute = createRoute({
  method: "get",
  path: "/api/articles/{slug}/comments",
  tags: ["comments"],
  summary: "List comments on an article",
  request: { params: SlugParam },
  responses: {
    200: {
      description: "Comments",
      content: { "application/json": { schema: CommentListResponseSchema } },
    },
    404: {
      description: "Article not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const addCommentRoute = createRoute({
  method: "post",
  path: "/api/articles/{slug}/comments",
  tags: ["comments"],
  summary: "Add a comment on an article",
  request: {
    params: SlugParam,
    body: {
      required: true,
      content: { "application/json": { schema: CreateCommentRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: CommentResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Article not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    422: {
      description: "Unprocessable entity",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const deleteCommentRoute = createRoute({
  method: "delete",
  path: "/api/articles/{slug}/comments/{id}",
  tags: ["comments"],
  summary: "Delete own comment on an article",
  request: { params: SlugAndIdParams },
  responses: {
    204: { description: "Deleted" },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Forbidden — viewer is not the comment author",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Article or comment not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const updateCommentRoute = createRoute({
  method: "put",
  path: "/api/articles/{slug}/comments/{id}",
  tags: ["comments"],
  summary: "Edit own comment body",
  request: {
    params: SlugAndIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateCommentRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: CommentResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Forbidden — viewer is not the comment author",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Article or comment not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    422: {
      description: "Unprocessable entity",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const registerCommentRoutes = (app: OpenAPIHono<AppEnv>): void => {
  const authed = app as unknown as OpenAPIHono<CommentEnv>;

  // GET is anonymous-friendly; viewer-relative `following` only meaningful
  // for authenticated callers but the endpoint never 401s.
  authed.use(listCommentsRoute.getRoutingPath(), optionalAuth());
  authed.openapi(listCommentsRoute, async (c) => {
    const viewer = c.get("user");
    const { slug } = c.req.valid("param");
    try {
      const comments = await listComments(slug, viewer?.id ?? null);
      return c.json({ comments }, 200);
    } catch (err) {
      if (err instanceof CommentError && err.status === 404) {
        return c.json(jsonError(err.field, err.detail), 404);
      }
      throw err;
    }
  });

  // Same path-shape discipline as articles update/delete: GET + POST
  // share `/api/articles/{slug}/comments`, and Hono's `app.use(path,...)`
  // is method-agnostic. Handler-level `if (!viewer) → 401` is what
  // keeps anonymous GET working while POST enforces auth.
  //
  // Rate limit uses `methods: ["POST"]` so anonymous + authed GETs
  // pass through unthrottled (#116).
  authed.use(
    addCommentRoute.getRoutingPath(),
    rateLimit({
      bucket: "comments:post",
      limit: 20,
      windowSec: 60,
      keyBy: "user",
      methods: ["POST"],
    }),
  );
  authed.openapi(addCommentRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("token", "is missing"), 401);
    const { slug } = c.req.valid("param");
    const { comment } = c.req.valid("json");
    try {
      const envelope = await addComment(viewer.id, slug, comment.body);
      return c.json({ comment: envelope }, 201);
    } catch (err) {
      if (err instanceof CommentError && err.status === 404) {
        return c.json(jsonError(err.field, err.detail), 404);
      }
      throw err;
    }
  });

  // DELETE /api/articles/{slug}/comments/{id} — mount requireAuth here;
  // it's a distinct path from the shared slug/comments prefix so no
  // stacking risk on the GET route.
  authed.use(deleteCommentRoute.getRoutingPath(), requireAuth());
  authed.use(
    deleteCommentRoute.getRoutingPath(),
    rateLimit({
      bucket: "comments:delete",
      limit: 30,
      windowSec: 60,
      keyBy: "user",
      methods: ["DELETE"],
    }),
  );
  authed.openapi(deleteCommentRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("token", "is missing"), 401);
    const { slug, id } = c.req.valid("param");
    try {
      await deleteComment(viewer.id, slug, id);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof CommentError) {
        if (err.status === 404) return c.json(jsonError(err.field, err.detail), 404);
        if (err.status === 403) return c.json(jsonError(err.field, err.detail), 403);
      }
      throw err;
    }
  });

  // PUT shares the same path as DELETE, so the requireAuth() /
  // rate-limit middleware above already covers it (Hono's
  // `app.use(path, ...)` is method-agnostic but rate-limit's
  // `methods: ["DELETE"]` narrow means PUT must register its own
  // throttle bucket — slightly smaller because edits are rarer
  // than deletes in most audience traffic patterns.
  authed.use(
    updateCommentRoute.getRoutingPath(),
    rateLimit({
      bucket: "comments:put",
      limit: 20,
      windowSec: 60,
      keyBy: "user",
      methods: ["PUT"],
    }),
  );
  authed.openapi(updateCommentRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("token", "is missing"), 401);
    const { slug, id } = c.req.valid("param");
    const { comment } = c.req.valid("json");
    try {
      const envelope = await updateComment(viewer.id, slug, id, comment.body);
      return c.json({ comment: envelope }, 200);
    } catch (err) {
      if (err instanceof CommentError) {
        if (err.status === 404) return c.json(jsonError(err.field, err.detail), 404);
        if (err.status === 403) return c.json(jsonError(err.field, err.detail), 403);
        if (err.status === 422) return c.json(jsonError(err.field, err.detail), 422);
      }
      throw err;
    }
  });
};
