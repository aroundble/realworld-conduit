import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "../logger.js";
import type { RequestIdVars } from "./request-id.js";

// Spec-shaped error envelope per RealWorld: {"errors": {"body": [...]}}.
// HTTPException instances are re-thrown by @hono/zod-openapi validators and
// friends with a safe-ish client-facing message — surface those as-is. All
// other throws are treated as internal and their messages are never echoed.
export const errorHandler = (
  err: Error,
  c: Context<{ Variables: RequestIdVars }>,
) => {
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
