import { createMiddleware } from "hono/factory";
import { logger } from "../logger.js";
import type { RequestIdVars } from "./request-id.js";

export const requestLogger = () =>
  createMiddleware<{ Variables: RequestIdVars }>(async (c, next) => {
    const started = Date.now();
    await next();
    logger.info({
      requestId: c.get("requestId"),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      // snake_case matches the #25 AC which names the key `duration_ms`.
      // Pino records the line as structured JSON so downstream log
      // consumers can filter on this key verbatim.
      duration_ms: Date.now() - started,
    });
  });
