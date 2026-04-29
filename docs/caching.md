# HTTP caching (#151)

The API emits `Cache-Control` + `Vary` + `ETag` headers so
downstream caches (CDN, browser, reverse proxy) serve cached
responses on anonymous reads without hitting the origin. Cache-
friendly headers turn into ~90% origin-load savings on a busy
homepage.

## Policy

| Route class | Cache-Control |
|---|---|
| `GET /api/articles` (anon, no `q`) | `public, max-age=60, stale-while-revalidate=300` |
| `GET /api/articles?q=` (search) | `public, max-age=30, stale-while-revalidate=60` |
| `GET /api/articles/:slug` (anon) | `public, max-age=60, stale-while-revalidate=300` |
| `GET /api/tags` | `public, max-age=300, stale-while-revalidate=900` |
| `GET /api/profiles/:username` (anon) | `public, max-age=120, stale-while-revalidate=600` |
| Any authenticated GET (cookie / bearer) | `private, no-cache` |
| Any mutation (POST/PUT/DELETE) | `no-store` |
| Unknown GET | `private, no-cache` (fail-safe default) |

Tag list gets the longest TTL — the set changes slowly and tags
are a high-traffic surface (homepage sidebar). Search gets the
tightest so new articles surface quickly.

## Vary

Every response sets `Vary: Accept, Accept-Encoding` (merged with
whatever Vary was already there — CORS adds `Origin`). Prevents
gzip + brotli variants from serving each other and content-
negotiated responses from cross-contaminating.

## ETag + If-None-Match

Every cacheable GET with status 200 gets a `SHA-1` hash of the
response body as its `ETag` (strong validator, wrapped in double
quotes). If the client sends `If-None-Match: "<etag>"` and the
hash matches, the server responds `304 Not Modified` with no
body. Saves bandwidth; CDNs use it for revalidation.

Mutation + authenticated responses get no ETag — per-user data
shouldn't leak into what's meant to be an opaque validator.

## Gate

`API_CACHE_ENABLED=1` turns the whole middleware on. OFF in
local dev + CI by default so Bruno conformance's byte-exact
assertions aren't perturbed by 304 short-circuits. Production
compose sets the flag.

## Bypassing the cache

Clients that want a fresh origin read can send
`Cache-Control: no-cache` themselves — most CDNs honor it. For
the browser, forcing a reload (Shift+Reload in Chrome/Firefox)
bypasses the cache.

## Follow-ups

- Surrogate-Control header for CDN-specific TTLs (deferred until
  a CDN is wired).
- `cache_hit_ratio` metric once a downstream cache is wired
  (would pair with #139's prom-client setup).
- Server-side response caching (actual cache storage) — these
  headers just tell downstream caches what to do; the server
  still recomputes every response.
