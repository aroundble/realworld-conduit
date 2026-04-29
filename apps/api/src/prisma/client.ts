// Prisma 7 ships two adjustments we have to accommodate here:
//   1. `@prisma/client` is emitted as CommonJS — under NodeNext ESM
//      resolution Node can't always synthesise named exports, so we
//      pull the default and destructure at runtime. The type-only
//      `PrismaClient` named import is erased at compile time.
//   2. Engine type defaults to `"client"` which refuses to start
//      without either a driver adapter or Accelerate URL. We ship the
//      stable `@prisma/adapter-pg` adapter so the same JWT/bcrypt
//      endpoints work locally, in CI, and in deployed envs without
//      Accelerate.
import pkg, { type PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "../logger.js";
const { PrismaClient: PrismaClientCtor } = pkg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required — see infra/docker-compose.yml / .env");
}
const adapter = new PrismaPg({ connectionString: databaseUrl });

// In development, tsx re-imports this module on every file change. Without a
// singleton, each reload would open a new connection pool until Postgres
// rejects further clients. Hanging the client off globalThis keeps a single
// instance across module reloads; production builds import once so the
// attachment is a no-op there.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClientCtor({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

const disconnect = async (signal: string): Promise<void> => {
  logger.info({ signal }, "disconnecting prisma");
  await prisma.$disconnect();
};

process.once("beforeExit", () => {
  void prisma.$disconnect();
});
process.once("SIGTERM", () => {
  void disconnect("SIGTERM");
});
process.once("SIGINT", () => {
  void disconnect("SIGINT");
});
