import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";
import {
  ProfileError,
  followUser,
  getProfile,
  unfollowUser,
} from "../services/profile.service.js";
import { optionalAuth, requireAuth, type UserVars } from "../middleware/jwt-cookie.js";
import { ErrorResponseSchema } from "../schemas/user.js";
import { ProfileResponseSchema } from "../schemas/profile.js";
import { z } from "@hono/zod-openapi";

type ProfileVars = AppEnv["Variables"] & UserVars;
type ProfileEnv = { Variables: ProfileVars };

const UsernameParam = z
  .object({
    username: z.string().min(1).openapi({ param: { name: "username", in: "path" } }),
  })
  .openapi("UsernameParam");

const jsonError = (field: string, detail: string) => ({
  errors: { [field]: [detail] },
});

const getProfileRoute = createRoute({
  method: "get",
  path: "/api/profiles/{username}",
  tags: ["profiles"],
  summary: "View a user's profile",
  request: { params: UsernameParam },
  responses: {
    200: {
      description: "Profile",
      content: { "application/json": { schema: ProfileResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const followRoute = createRoute({
  method: "post",
  path: "/api/profiles/{username}/follow",
  tags: ["profiles"],
  summary: "Follow a user",
  request: { params: UsernameParam },
  responses: {
    200: {
      description: "Followed",
      content: { "application/json": { schema: ProfileResponseSchema } },
    },
    401: {
      description: "Unauthorized",
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

const unfollowRoute = createRoute({
  method: "delete",
  path: "/api/profiles/{username}/follow",
  tags: ["profiles"],
  summary: "Unfollow a user",
  request: { params: UsernameParam },
  responses: {
    200: {
      description: "Unfollowed",
      content: { "application/json": { schema: ProfileResponseSchema } },
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

export const registerProfileRoutes = (app: OpenAPIHono<AppEnv>): void => {
  const authed = app as unknown as OpenAPIHono<ProfileEnv>;

  authed.use(getProfileRoute.getRoutingPath(), optionalAuth());
  authed.openapi(getProfileRoute, async (c) => {
    const viewer = c.get("user");
    const { username } = c.req.valid("param");
    try {
      const profile = await getProfile(username, viewer?.id ?? null);
      return c.json({ profile }, 200);
    } catch (err) {
      if (err instanceof ProfileError && err.status === 404) {
        return c.json(jsonError(err.field, err.detail), 404);
      }
      throw err;
    }
  });

  authed.use(followRoute.getRoutingPath(), requireAuth());
  authed.openapi(followRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("token", "is missing"), 401);
    const { username } = c.req.valid("param");
    try {
      const profile = await followUser(viewer.id, username);
      return c.json({ profile }, 200);
    } catch (err) {
      if (err instanceof ProfileError) {
        if (err.status === 404) return c.json(jsonError(err.field, err.detail), 404);
        return c.json(jsonError(err.field, err.detail), 422);
      }
      throw err;
    }
  });

  authed.openapi(unfollowRoute, async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json(jsonError("token", "is missing"), 401);
    const { username } = c.req.valid("param");
    try {
      const profile = await unfollowUser(viewer.id, username);
      return c.json({ profile }, 200);
    } catch (err) {
      if (err instanceof ProfileError && err.status === 404) {
        return c.json(jsonError(err.field, err.detail), 404);
      }
      throw err;
    }
  });
};
