import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";

const HealthSchema = z
  .object({ ok: z.boolean() })
  .openapi("Health");

const healthzRoute = createRoute({
  method: "get",
  path: "/healthz",
  tags: ["meta"],
  summary: "Liveness probe",
  responses: {
    200: {
      description: "Service is up",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

export const registerHealthzRoute = (app: OpenAPIHono<AppEnv>): void => {
  app.openapi(healthzRoute, (c) => c.json({ ok: true }, 200));
};
