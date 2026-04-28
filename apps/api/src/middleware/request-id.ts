import { createMiddleware } from "hono/factory";
import { randomUUID } from "node:crypto";

const HEADER = "x-request-id";

export type RequestIdVars = { requestId: string };

export const requestId = () =>
  createMiddleware<{ Variables: RequestIdVars }>(async (c, next) => {
    const inbound = c.req.header(HEADER);
    const id = inbound && inbound.length > 0 ? inbound : randomUUID();
    c.set("requestId", id);
    c.header(HEADER, id);
    await next();
  });
