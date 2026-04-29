import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { prisma } from "../prisma/client.js";
import type { UserVars } from "./jwt-cookie.js";
import { rateLimitRejectionsTotal } from "./metrics.js";

// Per-bucket rate limiter backed by the RateLimit table (#116).
//
// Model: fixed-window counter. Every request increments the
// `(bucket, key, floor(now/windowSec))` row atomically via upsert;
// when the incremented hits exceed `limit`, the request is rejected
// 429 with a Retry-After hint. Fixed windows allow bursts at the
// window boundary but the AC's absolute count-per-minute promise is
// kept (≥ limit requests in ≤ windowSec is always caught).
//
// Storage choice (ADR 001 §"Rate limiting"): Postgres over Redis.
// The compose stack already runs Postgres; keeping single-dependency
// matches the Level-2 ladder's "no new infra" constraint. Upsert
// contention at the expected request rate is trivially <1ms; under
// high load Redis would be faster but also a new SPOF.
//
// Disable knob: `RATE_LIMIT_ENABLED=0` short-circuits the middleware
// for local dev + Bruno conformance runs where the canonical
// collection fires ~50 writes in rapid succession.

export type RateLimitKeyStrategy = "ip" | "user";

export type RateLimitOptions = {
  // Short identifier for the endpoint class — used as the
  // `bucket` column. Pick something route-scoped and stable
  // (e.g. "users:register", "articles:write").
  bucket: string;
  // Max requests per window before 429.
  limit: number;
  // Window size in seconds. AC uses 60s uniformly; the argument is
  // exposed for future per-endpoint tuning.
  windowSec: number;
  // How the middleware derives the per-caller key:
  //  - "ip"   → client IP (X-Forwarded-For head, else remote addr).
  //  - "user" → authenticated viewer id. Requires `requireAuth()` or
  //             `optionalAuth()` earlier in the pipeline so
  //             `c.get("user")` is set. Anonymous callers on a
  //             user-keyed route fall back to ip (so the route still
  //             has a cap even if somehow hit unauthed).
  keyBy: RateLimitKeyStrategy;
  // Optional method filter. When the incoming request's method is
  // not in the list, the middleware is a no-op — lets the caller
  // share the same path across read + write without double-counting
  // the read. Hono's `app.use(path, mw)` is method-agnostic, so the
  // filter lives here.
  methods?: readonly ("POST" | "PUT" | "DELETE" | "PATCH")[];
};

const DEFAULT_ENABLED = process.env.RATE_LIMIT_ENABLED === "1";

const clientIp = (c: Context): string => {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  // Fallback for direct connections. Hono doesn't expose remoteAddr
  // uniformly across adapters; use "unknown" as a stable last-resort
  // key so the bucket still counts. In production we sit behind a
  // reverse proxy that always sets X-Forwarded-For.
  return "unknown";
};

const keyFor = (
  c: Context<{ Variables: UserVars }>,
  strategy: RateLimitKeyStrategy,
): string => {
  if (strategy === "user") {
    const user = c.get("user");
    if (user) return `u:${user.id}`;
  }
  return `ip:${clientIp(c)}`;
};

const jsonError = (detail: string) => ({
  errors: { rate: [detail] },
});

export const rateLimit = (opts: RateLimitOptions) =>
  createMiddleware<{ Variables: UserVars }>(async (c, next) => {
    if (!DEFAULT_ENABLED) {
      await next();
      return;
    }
    if (opts.methods && !opts.methods.includes(c.req.method as "POST")) {
      await next();
      return;
    }

    const key = keyFor(c, opts.keyBy);
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowSec / opts.windowSec) * opts.windowSec;
    const windowEnd = windowStart + opts.windowSec;
    const retryAfter = Math.max(1, windowEnd - nowSec);

    // Atomic increment-or-create. Prisma upsert compiles to
    // `INSERT ... ON CONFLICT DO UPDATE SET hits = hits + 1 RETURNING hits`,
    // so two concurrent requests can't race into the same slot.
    const row = await prisma.rateLimit.upsert({
      where: {
        rate_limit_slot: {
          bucket: opts.bucket,
          key,
          windowStart,
        },
      },
      create: {
        bucket: opts.bucket,
        key,
        windowStart,
        hits: 1,
      },
      update: {
        hits: { increment: 1 },
      },
      select: { hits: true },
    });

    const remaining = Math.max(0, opts.limit - row.hits);
    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(windowEnd));

    if (row.hits > opts.limit) {
      c.header("Retry-After", String(retryAfter));
      rateLimitRejectionsTotal.inc({ endpoint: opts.bucket });
      return c.json(
        jsonError("too many requests, please try again later"),
        429,
      );
    }

    await next();
  });
