import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "../logger.js";
import { AuthError } from "../services/auth.service.js";
import { COOKIE_NAME } from "./jwt-cookie.js";
import { deleteCookie } from "hono/cookie";
import { config } from "../config.js";
import type { RequestIdVars } from "./request-id.js";

// Spec-shaped error envelope per RealWorld: {"errors": {"body": [...]}}.
// HTTPException instances are re-thrown by @hono/zod-openapi validators and
// friends with a safe-ish client-facing message — surface those as-is. All
// other throws are treated as internal and their messages are never echoed.
export const errorHandler = (
  err: Error,
  c: Context<{ Variables: RequestIdVars }>,
) => {
  if (err instanceof AuthError) {
    // Missing/invalid/expired session: clear the stale cookie on 401 so
    // the browser doesn't keep resending it on every navigation (the
    // expired-token scenario in issue #5's AC).
    if (err.status === 401) {
      deleteCookie(c, COOKIE_NAME, {
        path: "/",
        domain: config.cookieDomain,
        secure: config.cookieSecure,
      });
    }
    return c.json({ errors: { [err.field]: [err.detail] } }, err.status);
  }

  if (err instanceof HTTPException) {
    const response = err.getResponse();
    if (response.headers.get("content-type")?.includes("application/json")) {
      return response;
    }
    return c.json(
      { errors: { body: [err.message] } },
      err.status,
    );
  }

  logger.error({
    requestId: c.get("requestId"),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    err: { message: err.message, stack: err.stack },
  });

  return c.json(
    { errors: { body: ["Internal server error"] } },
    500,
  );
};
