import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";
import { listTopTags } from "../services/tags.service.js";

const TagsResponseSchema = z
  .object({ tags: z.array(z.string()) })
  .openapi("TagsResponse");

const listTagsRoute = createRoute({
  method: "get",
  path: "/api/tags",
  tags: ["tags"],
  summary: "List top tags by usage (up to 20)",
  responses: {
    200: {
      description: "Tag names, ordered by article-count descending",
      content: { "application/json": { schema: TagsResponseSchema } },
    },
  },
});

export const registerTagsRoutes = (app: OpenAPIHono<AppEnv>): void => {
  app.openapi(listTagsRoute, async (c) => {
    const tags = await listTopTags();
    return c.json({ tags }, 200);
  });
};
