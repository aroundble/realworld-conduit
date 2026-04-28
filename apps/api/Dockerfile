# syntax=docker/dockerfile:1.7
# Hono API — tsc-built Node 22 service.

FROM node:22-alpine AS base
RUN corepack enable

# ---- deps ----
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @conduit/api... --frozen-lockfile=false

# ---- builder ----
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/api ./apps/api
# Generate Prisma Client into node_modules before tsc so typecheck + build
# see the generated types; pnpm deploy carries the generated artefact into
# the runner image via node_modules.
RUN pnpm --filter @conduit/api exec prisma generate
RUN pnpm --filter @conduit/api build

# ---- deploy ----
# pnpm deploy materialises a self-contained node_modules with real files
# (no symlinks into the workspace store), ready to ship to a runner image.
FROM base AS deploy
WORKDIR /repo
COPY --from=builder /repo ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm deploy --legacy --filter @conduit/api --prod /prod/api

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 hono

COPY --from=deploy --chown=hono:nodejs /prod/api/dist ./dist
COPY --from=deploy --chown=hono:nodejs /prod/api/package.json ./package.json
COPY --from=deploy --chown=hono:nodejs /prod/api/node_modules ./node_modules
# Schema + migrations must ship into the runner so `prisma migrate deploy`
# can diff them against the live database at container start. Chown so the
# schema-engine CLI (spawned by prisma under the hono user) can cache its
# downloaded binary next to the JS bundle without permission errors.
COPY --from=deploy --chown=hono:nodejs /prod/api/prisma ./prisma
COPY --from=deploy --chown=hono:nodejs /prod/api/prisma.config.ts ./prisma.config.ts
COPY --chmod=0755 apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER hono

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
