import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  ({ port }) => {
    console.log(`[api] listening on :${port} (env=${config.nodeEnv})`);
  },
);

const shutdown = (signal: string): void => {
  console.log(`[api] ${signal} received — shutting down`);
  server.close(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
