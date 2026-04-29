import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../app.js";
import { logger } from "../logger.js";
import { prisma } from "../prisma/client.js";

const HealthSchema = z
  .object({
    ok: z.boolean(),
    checks: z.object({ db: z.enum(["ok", "fail"]) }),
  })
  .openapi("Health");

const healthzRoute = createRoute({
  method: "get",
  path: "/healthz",
  tags: ["meta"],
  summary: "Liveness + dependency probe",
  responses: {
    200: {
      description: "Service is up and dependencies respond",
      content: { "application/json": { schema: HealthSchema } },
    },
    503: {
      description: "A dependency is not answering",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

// HEALTHCHECK_DB_TIMEOUT_MS bounds the DB probe so an unreachable
// postgres doesn't wedge the endpoint (and, by extension, the
// container healthcheck + any upstream load balancer).
const dbTimeoutMs = Number.parseInt(
  process.env.HEALTHCHECK_DB_TIMEOUT_MS ?? "2000",
  10,
);

const probeDb = async (): Promise<"ok" | "fail"> => {
  const timeout = new Promise<"fail">((resolve) => {
    setTimeout(() => resolve("fail"), dbTimeoutMs).unref();
  });
  const query = prisma
    .$queryRaw`SELECT 1`.then(() => "ok" as const)
    .catch((err: unknown) => {
      logger.warn({ err: String(err) }, "healthz: db probe failed");
      return "fail" as const;
    });
  return Promise.race([query, timeout]);
};

export const registerHealthzRoute = (app: OpenAPIHono<AppEnv>): void => {
  app.openapi(healthzRoute, async (c) => {
    const db = await probeDb();
    const ok = db === "ok";
    return c.json({ ok, checks: { db } }, ok ? 200 : 503);
  });
};
