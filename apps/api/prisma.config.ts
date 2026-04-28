import "node:process";
import { defineConfig } from "prisma/config";

// Prisma 7 requires the datasource URL in config (schema.prisma no longer
// accepts `url = env(...)`). We read DATABASE_URL at module-load time but
// only pass it to `datasource` when present — `prisma generate` doesn't
// need a URL, while `prisma migrate dev / deploy` does. The migrate
// commands emit a clear "no URL" error on their own if the env is unset;
// `docker-entrypoint.sh` guarantees it's set inside the runner container.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
