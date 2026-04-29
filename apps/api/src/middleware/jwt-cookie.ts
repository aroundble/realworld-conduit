import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { AuthError, verifyToken, type JwtPayload } from "../services/auth.service.js";

// Strict + soft JWT-cookie carriers for issue #5.
//
// Carrier precedence: `Authorization: Token <jwt>` wins when both the
// header and a cookie are present (Postman-compat path wins — matches
// AC5 under deterministic dual-carrier conditions).
//
// Missing/expired/invalid token on a strict-auth route throws
// AuthError("token", "is missing", 401), which the global error
// handler (middleware/error.ts) renders as JSON
// `{"errors":{"token":["is missing"]}}` and pairs with
// `Set-Cookie: conduit_session=; Max-Age=0` to clear the stale cookie
// (AC3). Soft-auth swallows the same error and proceeds anonymously.
// The envelope shape matches the canonical RealWorld Bruno
// collection's 13 no-auth / bad-token assertions — see #62 / ADR §18.

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

const pickToken = (
  header: string | null,
  cookie: string | null,
): string | null => header ?? cookie;

export const optionalAuth = () =>
  createMiddleware<{ Variables: UserVars }>(async (c, next) => {
    const headerToken = readBearer(c.req.header(AUTH_HEADER));
    const cookieToken = getCookie(c, COOKIE_NAME) ?? null;
    const token = pickToken(headerToken, cookieToken);
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
    const token = pickToken(headerToken, cookieToken);
    if (!token) {
      throw new AuthError("token", "is missing", 401);
    }
    c.set("user", verifyToken(token));
    await next();
  });
