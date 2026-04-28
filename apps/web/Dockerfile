# syntax=docker/dockerfile:1.7
# Next.js 16 standalone build — produces a small self-contained runtime.

FROM node:22-alpine AS base
RUN corepack enable

# ---- deps ----
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @conduit/web... --frozen-lockfile=false

# ---- builder ----
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && pnpm --filter @conduit/web build

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

USER nextjs

ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
