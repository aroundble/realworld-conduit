import { PrismaClient } from "@prisma/client";

// In development, tsx re-imports this module on every file change. Without a
// singleton, each reload would open a new connection pool until Postgres
// rejects further clients. Hanging the client off globalThis keeps a single
// instance across module reloads; production builds import once so the
// attachment is a no-op there.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

const disconnect = async (signal: string): Promise<void> => {
  console.log(`[api] ${signal} received — disconnecting prisma`);
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
