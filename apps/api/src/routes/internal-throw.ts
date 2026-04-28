import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";
import { config } from "../config.js";

// Test-only unhandled-error route. Wired under `/_throw` when
// NODE_ENV !== "production" so acceptance tests can exercise the
// global error handler without shipping the path in the OpenAPI doc
// or in the production bundle's routing table.
export const registerInternalThrowRoute = (app: OpenAPIHono<AppEnv>): void => {
  if (config.nodeEnv === "production") return;

  app.get("/_throw", () => {
    throw new Error("boom — deliberate test failure");
  });
};
