import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { AuthError, verifyToken, type JwtPayload } from "../services/auth.service.js";

// Skeleton JWT-cookie carrier middleware for issue #4.
//
// Issue #5 will expand this with explicit strict + soft factories, the
// expired-token cookie clear, and the dual-carrier precedence rule. For
// #4 we only need a helper that #4's own GET /api/user route can call to
// read the current user from either carrier, returning `null` when
// neither is present or when the token fails verification.
//
// Carrier precedence matches the spec's future #5 AC: `Authorization:
// Token <jwt>` wins when both headers are present (Postman-compat path
// wins for deterministic behaviour under dual-carrier conditions).

export const COOKIE_NAME = "conduit_session";
const AUTH_HEADER = "Authorization";
const AUTH_PREFIX = "Token ";

export type UserVars = { user: JwtPayload | null };

export const readBearer = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  if (!headerValue.startsWith(AUTH_PREFIX)) return null;
  const token = headerValue.slice(AUTH_PREFIX.length).trim();
  return token.length > 0 ? token : null;
};

export const optionalAuth = () =>
  createMiddleware<{ Variables: UserVars }>(async (c, next) => {
    const headerToken = readBearer(c.req.header(AUTH_HEADER));
    const cookieToken = getCookie(c, COOKIE_NAME) ?? null;
    const token = headerToken ?? cookieToken;
    if (!token) {
      c.set("user", null);
      await next();
      return;
    }
    try {
      c.set("user", verifyToken(token));
    } catch {
      c.set("user", null);
    }
    await next();
  });

export const requireAuth = () =>
  createMiddleware<{ Variables: UserVars }>(async (c, next) => {
    const headerToken = readBearer(c.req.header(AUTH_HEADER));
    const cookieToken = getCookie(c, COOKIE_NAME) ?? null;
    const token = headerToken ?? cookieToken;
    if (!token) {
      throw new AuthError("auth", "Unauthorized", 401);
    }
    c.set("user", verifyToken(token));
    await next();
  });
