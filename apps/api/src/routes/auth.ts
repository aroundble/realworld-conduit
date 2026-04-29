import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../app.js";
import { config } from "../config.js";
import {
  AuthError,
  getUserById,
  loginUser,
  registerUser,
  updateUser,
} from "../services/auth.service.js";
import { COOKIE_NAME, requireAuth, type UserVars } from "../middleware/jwt-cookie.js";
import {
  ErrorResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  UpdateUserRequestSchema,
  UserResponseSchema,
} from "../schemas/user.js";

type AuthVars = AppEnv["Variables"] & UserVars;
type AuthEnv = { Variables: AuthVars };

// Cookie attributes shared by every mutation that issues a session.
// `Secure` is env-driven (true in prod, false local) so dev over plain
// HTTP works; `SameSite=Lax` keeps cookies on top-level navigations
// but blocks cross-site POSTs, matching the spec's CSRF posture.
const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: "Lax" as const,
  path: "/",
  maxAge: config.jwtTtlSeconds,
  domain: config.cookieDomain,
});

const jsonError = (field: string, detail: string) => ({
  errors: { [field]: [detail] },
});

const registerRoute = createRoute({
  method: "post",
  path: "/api/users",
  tags: ["auth"],
  summary: "Register a new user",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: RegisterRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: UserResponseSchema } },
    },
    422: {
      description: "Unprocessable entity",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/api/users/login",
  tags: ["auth"],
  summary: "Log in an existing user",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: LoginRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Authenticated",
      content: { "application/json": { schema: UserResponseSchema } },
    },
    401: {
      description: "Invalid credentials",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const currentUserRoute = createRoute({
  method: "get",
  path: "/api/user",
  tags: ["auth"],
  summary: "Get the authenticated user",
  responses: {
    200: {
      description: "Current user",
      content: { "application/json": { schema: UserResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const updateUserRoute = createRoute({
  method: "put",
  path: "/api/user",
  tags: ["auth"],
  summary: "Update the authenticated user",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateUserRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: UserResponseSchema } },
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

export const registerAuthRoutes = (app: OpenAPIHono<AppEnv>): void => {
  const authed = app as unknown as OpenAPIHono<AuthEnv>;

  app.openapi(registerRoute, async (c) => {
    const { user } = c.req.valid("json");
    try {
      const envelope = await registerUser(user);
      setCookie(c, COOKIE_NAME, envelope.token, sessionCookieOptions());
      c.header("Authorization", `Token ${envelope.token}`);
      return c.json({ user: envelope }, 201);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json(jsonError(err.field, err.detail), 422);
      }
      throw err;
    }
  });

  app.openapi(loginRoute, async (c) => {
    const { user } = c.req.valid("json");
    try {
      const envelope = await loginUser(user);
      setCookie(c, COOKIE_NAME, envelope.token, sessionCookieOptions());
      c.header("Authorization", `Token ${envelope.token}`);
      return c.json({ user: envelope }, 200);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json(jsonError(err.field, err.detail), 401);
      }
      throw err;
    }
  });

  authed.use(currentUserRoute.getRoutingPath(), requireAuth());
  authed.openapi(currentUserRoute, async (c) => {
    const current = c.get("user");
    if (!current) {
      return c.json(jsonError("auth", "Unauthorized"), 401);
    }
    const envelope = await getUserById(current.id);
    if (!envelope) {
      return c.json(jsonError("auth", "Unauthorized"), 401);
    }
    c.header("Authorization", `Token ${envelope.token}`);
    return c.json({ user: envelope }, 200);
  });

  authed.use(updateUserRoute.getRoutingPath(), requireAuth());
  authed.openapi(updateUserRoute, async (c) => {
    const current = c.get("user");
    if (!current) {
      return c.json(jsonError("auth", "Unauthorized"), 401);
    }
    const { user } = c.req.valid("json");
    try {
      const envelope = await updateUser(current.id, user);
      setCookie(c, COOKIE_NAME, envelope.token, sessionCookieOptions());
      c.header("Authorization", `Token ${envelope.token}`);
      return c.json({ user: envelope }, 200);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json(jsonError(err.field, err.detail), 422);
      }
      throw err;
    }
  });
};
