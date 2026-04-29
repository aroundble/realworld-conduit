import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";

// HTTP cache headers (#151). Sets Cache-Control per-route so
// downstream caches (CDN, browser, reverse proxy) can serve
// cached responses on anonymous list reads without hitting the
// origin, while keeping authenticated + mutation responses
// off-limits.
//
// Policy summary:
//   GET  /api/articles (anon)      → public, max-age=60,  swr=300
//   GET  /api/articles?q= (search) → public, max-age=30,  swr=60
//   GET  /api/articles/:slug       → public, max-age=60,  swr=300
//   GET  /api/articles/feed        → private, no-cache   (authed)
//   GET  /api/tags                 → public, max-age=300, swr=900
//   GET  /api/profiles/:username   → public, max-age=120, swr=600
//   GET  /api/user (current user)  → private, no-cache
//   Any authenticated GET          → private, no-cache
//   Any mutation (POST/PUT/DELETE) → no-store
//
// ETag: every cacheable GET gets a SHA-1 hash of the response
// body. If the client's `If-None-Match` header matches, we 304
// with no body. Saves bandwidth; CDNs use it for revalidation.
//
// Gate: `API_CACHE_ENABLED=1` turns the whole middleware on. OFF
// in local dev so Bruno's conformance pass (which asserts byte-
// exact response bodies) isn't affected by 304 short-circuits.
// Production compose sets the flag.

const ENABLED = process.env.API_CACHE_ENABLED === "1";

type CachePolicy =
  | { kind: "public"; maxAge: number; swr: number }
  | { kind: "private" }
  | { kind: "mutation" };

const toHeader = (policy: CachePolicy): string => {
  if (policy.kind === "public") {
    return `public, max-age=${policy.maxAge}, stale-while-revalidate=${policy.swr}`;
  }
  if (policy.kind === "private") return "private, no-cache";
  return "no-store";
};

// Decide the policy from the final matched route + method + auth
// state. Matches on Hono's `routePath` patterns so new routes
// added later fall into the "unknown GET" default rather than
// accidentally inheriting aggressive caching.
const policyFor = (
  method: string,
  routePath: string,
  isAuthed: boolean,
  hasSearchQuery: boolean,
): CachePolicy => {
  if (method !== "GET" && method !== "HEAD") {
    return { kind: "mutation" };
  }
  // Authenticated requests always get private caching — one
  // user's response must never serve another. The /api/user and
  // /api/articles/feed endpoints are authenticated by nature.
  if (isAuthed) return { kind: "private" };

  // Search-bearing list reads get a tighter TTL — new articles
  // should show up in search results quickly.
  if (routePath === "/api/articles" && hasSearchQuery) {
    return { kind: "public", maxAge: 30, swr: 60 };
  }
  if (routePath === "/api/articles") {
    return { kind: "public", maxAge: 60, swr: 300 };
  }
  if (routePath === "/api/articles/:slug") {
    return { kind: "public", maxAge: 60, swr: 300 };
  }
  if (routePath === "/api/tags") {
    return { kind: "public", maxAge: 300, swr: 900 };
  }
  if (routePath === "/api/profiles/:username") {
    return { kind: "public", maxAge: 120, swr: 600 };
  }
  // Unknown GET — be conservative, no public caching. Keeps new
  // routes safe by default until they're reviewed.
  return { kind: "private" };
};

// SHA-1 of the response body. Hash alone is enough; the output
// header gets wrapped in double quotes (strong validator) so
// clients + caches handle it as an opaque identifier.
const computeEtag = (body: string | Uint8Array): string => {
  const hash = createHash("sha1");
  hash.update(body);
  return `"${hash.digest("hex")}"`;
};

// Extract a text body from the Hono response so we can hash it.
// `c.res.clone()` lets us read without consuming the stream the
// caller will ultimately send. If the body isn't text-like we
// skip the ETag — binary responses aren't in our API surface.
const readResponseText = async (res: Response): Promise<string | null> => {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json") && !contentType.includes("text")) {
    return null;
  }
  try {
    return await res.clone().text();
  } catch {
    return null;
  }
};

// Authenticated check: look at the session cookie header on the
// request, not at the user context var (which may not be set yet
// depending on which middleware ran). An Authorization header or
// non-empty conduit_session cookie both count.
const detectAuth = (headers: Headers): boolean => {
  const auth = headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("token ")) return true;
  if (auth.toLowerCase().startsWith("bearer ")) return true;
  const cookie = headers.get("cookie") ?? "";
  if (/(^|;\s*)conduit_session=[^;]+/.test(cookie)) return true;
  return false;
};

export const cacheHeaders = (): MiddlewareHandler =>
  async function cacheHeadersMiddleware(c, next) {
    await next();
    if (!ENABLED) return;

    const method = c.req.method;
    const routePath = c.req.routePath || "not-found";
    const authed = detectAuth(c.req.raw.headers);
    const hasSearchQuery =
      typeof c.req.query("q") === "string" && c.req.query("q") !== "";
    const policy = policyFor(method, routePath, authed, hasSearchQuery);

    c.res.headers.set("Cache-Control", toHeader(policy));
    // Vary so gzip + brotli variants don't cross-contaminate and
    // Accept-based content negotiation stays honest.
    const existingVary = c.res.headers.get("Vary") ?? "";
    const varyTokens = new Set(
      existingVary
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    );
    varyTokens.add("Accept");
    varyTokens.add("Accept-Encoding");
    c.res.headers.set("Vary", Array.from(varyTokens).join(", "));

    // ETag + 304 only for cacheable GET/HEAD. Authenticated and
    // mutation responses get no ETag (they'd leak per-user state
    // into what's meant to be an opaque validator).
    if (
      (method !== "GET" && method !== "HEAD") ||
      policy.kind !== "public" ||
      c.res.status !== 200
    ) {
      return;
    }

    const body = await readResponseText(c.res);
    if (body === null) return;
    const etag = computeEtag(body);
    c.res.headers.set("ETag", etag);

    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      // Strip the body; 304 must not carry one. Preserve
      // Cache-Control + ETag + Vary so the client refreshes its
      // cached copy's headers.
      c.res = new Response(null, {
        status: 304,
        headers: c.res.headers,
      });
    }
  };
