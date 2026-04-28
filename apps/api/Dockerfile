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

COPY --from=deploy /prod/api/dist ./dist
COPY --from=deploy /prod/api/package.json ./package.json
COPY --from=deploy /prod/api/node_modules ./node_modules

USER hono

CMD ["node", "dist/server.js"]
