import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";

export const createApp = (): Hono => {
  const app = new Hono();

  app.use("*", requestId());
  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      credentials: true,
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.notFound((c) => c.json({ errors: { body: ["not found"] } }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ errors: { body: [err.message] } }, 500);
  });

  return app;
};
