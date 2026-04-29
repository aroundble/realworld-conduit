import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import type { ZodIssue } from "zod";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error.js";
import { requestLogger } from "./middleware/logger.js";
import { requestId, type RequestIdVars } from "./middleware/request-id.js";
import { registerArticleRoutes } from "./routes/articles.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCommentRoutes } from "./routes/comments.js";
import { registerHealthzRoute } from "./routes/healthz.js";
import { registerInternalThrowRoute } from "./routes/internal-throw.js";
import { registerProfileRoutes } from "./routes/profiles.js";
import { registerTagsRoutes } from "./routes/tags.js";

export type AppEnv = { Variables: RequestIdVars };

// Convert a zod-validator failure into the RealWorld-spec error envelope:
//   { errors: { [field]: [message, ...], ... } }
// Status is 422 because that's the spec's code for "well-formed but
// unprocessable" (the framework default is 400, which doesn't match
// any reference implementation).
const spec422Hook = (result: unknown, c: Context) => {
  const r = result as {
    success?: boolean;
    error?: { issues?: ZodIssue[] };
  };
  if (r.success !== false) return;
  const errors: Record<string, string[]> = {};
  for (const issue of r.error?.issues ?? []) {
    // Drop the leading wrapper path segment (e.g. "user" / "article")
    // so the error key matches the reference's output ("title", not
    // "article.title"). Fall back to "body" if the path is empty.
    const path =
      issue.path.slice(1).join(".") || issue.path.join(".") || "body";
    (errors[path] ??= []).push(issue.message);
  }
  return c.json({ errors }, 422);
};

export const createApp = (): OpenAPIHono<AppEnv> => {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: spec422Hook });

  // request-id runs first so every downstream log line and error response
  // carries the same id (inbound X-Request-ID is preferred; otherwise a
  // UUID v4 is minted here and echoed back on the response).
  app.use("*", requestId());
  app.use("*", requestLogger());
  app.use("*", corsMiddleware());

  registerHealthzRoute(app);
  registerAuthRoutes(app);
  registerProfileRoutes(app);
  registerArticleRoutes(app);
  registerCommentRoutes(app);
  registerTagsRoutes(app);
  registerInternalThrowRoute(app);

  // Two doc surfaces (#123):
  //   - `/api/openapi.json` — machine-readable OpenAPI 3.1 spec,
  //     consumed by Swagger UI / Scalar / code generators.
  //   - `/api/docs` — Scalar-rendered API reference, public-readable
  //     for contributors + integrators.
  //
  // `/docs/json` is kept as a legacy alias so early links in the
  // docs tree (if any) don't break.
  const openapiConfig = {
    openapi: "3.1.0",
    info: {
      title: "RealWorld Conduit API",
      version: process.env.npm_package_version ?? "0.0.0",
      description:
        "RealWorld spec-conformant API. Routes are added per feature.",
    },
    servers: [
      {
        url: process.env.OPENAPI_HOST ?? "http://localhost:3001",
        description: "API host",
      },
    ],
  };
  app.doc("/api/openapi.json", openapiConfig);
  app.doc("/docs/json", openapiConfig);

  app.get(
    "/api/docs",
    Scalar({
      url: "/api/openapi.json",
      theme: "default",
      pageTitle: "Conduit API",
    }),
  );

  app.notFound((c) => c.json({ errors: { body: ["not found"] } }, 404));

  app.onError(errorHandler);

  return app;
};
