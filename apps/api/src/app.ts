import { OpenAPIHono } from "@hono/zod-openapi";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error.js";
import { requestLogger } from "./middleware/logger.js";
import { requestId, type RequestIdVars } from "./middleware/request-id.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthzRoute } from "./routes/healthz.js";
import { registerInternalThrowRoute } from "./routes/internal-throw.js";
import { registerProfileRoutes } from "./routes/profiles.js";

export type AppEnv = { Variables: RequestIdVars };

export const createApp = (): OpenAPIHono<AppEnv> => {
  const app = new OpenAPIHono<AppEnv>();

  // request-id runs first so every downstream log line and error response
  // carries the same id (inbound X-Request-ID is preferred; otherwise a
  // UUID v4 is minted here and echoed back on the response).
  app.use("*", requestId());
  app.use("*", requestLogger());
  app.use("*", corsMiddleware());

  registerHealthzRoute(app);
  registerAuthRoutes(app);
  registerProfileRoutes(app);
  registerInternalThrowRoute(app);

  app.doc("/docs/json", {
    openapi: "3.1.0",
    info: {
      title: "RealWorld Conduit API",
      version: "0.0.0",
      description:
        "RealWorld spec-conformant API. Routes are added per feature.",
    },
  });

  app.notFound((c) => c.json({ errors: { body: ["not found"] } }, 404));

  app.onError(errorHandler);

  return app;
};
