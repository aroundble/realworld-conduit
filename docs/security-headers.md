# Security headers (#124)

Baseline HTTP security headers on every API and web response. The
goal is a Level-2 production floor: each header closes a concrete
attack class a penetration test would otherwise flag. Together with
the request-body cap (#126) and rate-limiting (#116), these form the
reliability-and-security floor of the service.

## Header set

| Header | API | Web | Value |
|---|---|---|---|
| `X-Content-Type-Options` | ✓ | ✓ | `nosniff` |
| `X-Frame-Options` | ✓ | ✓ | `DENY` |
| `Referrer-Policy` | ✓ | ✓ | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | ✓ | ✓ | `camera=(), geolocation=(), microphone=()` |
| `Content-Security-Policy` |  | ✓ | see below |
| `Strict-Transport-Security` | ✓ (cloud) | ✓ (cloud) | `max-age=63072000; includeSubDomains; preload` when `ENFORCE_HSTS=true` |

API-only extras surfaced by `hono/secure-headers` defaults:
`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`,
`Origin-Agent-Cluster: ?1`,
`X-DNS-Prefetch-Control: off`,
`X-Download-Options: noopen`,
`X-Permitted-Cross-Domain-Policies: none`,
`X-XSS-Protection: 0`.

## CSP (web only)

```
default-src 'self';
img-src 'self' https: data:;
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
connect-src 'self' <NEXT_PUBLIC_API_URL>;
font-src 'self' data:;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

- `'unsafe-inline'` on `script-src` + `style-src` is what Next.js
  needs for its bootstrap inline scripts and inline `style` attrs.
  Tightening to nonce-based CSP requires rewiring the Next.js runtime
  via middleware and is tracked as a follow-up.
- `connect-src` includes `NEXT_PUBLIC_API_URL` so client-side fetches
  to the API aren't CSP-blocked. Value is baked at build time (see
  "Build-time vs runtime" below).
- `frame-ancestors 'none'` duplicates `X-Frame-Options: DENY` — modern
  browsers prefer the CSP directive, but we keep both because
  security scanners still flag apps that ship only one.

## Build-time vs runtime

**The CSP + HSTS decision is baked at build time** for the web app.
Next.js evaluates `next.config.ts` once per build and writes the
resolved headers into `.next/routes-manifest.json`; changing
`NEXT_PUBLIC_API_URL` or `ENFORCE_HSTS` at runtime does NOT update the
CSP. That's why the Dockerfile receives both as `ARG` + `ENV`:

```dockerfile
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG ENFORCE_HSTS
ENV ENFORCE_HSTS=${ENFORCE_HSTS}
RUN pnpm --filter @conduit/web build
```

And `infra/docker-compose.yml` passes the compose-level values
through as build args so a single `docker compose up --build` produces
the right image for the target env.

The API side uses runtime env — `hono/secure-headers` recomputes its
header list per-process startup, so `ENFORCE_HSTS=true` on restart is
enough to flip HSTS on.

## HSTS in local dev

**Never turn HSTS on for localhost.** A `max-age=63072000` header pins
the browser into treating `http://localhost` as HTTPS-only for 2
years, which breaks every other dev server on that host. The default
is off everywhere; only staging/prod compose files set
`ENFORCE_HSTS=true`.

## Adding a third-party script

1. Add its origin to `script-src` and, if it fetches data, to
   `connect-src` in `apps/web/next.config.ts`.
2. Rebuild the web image so the new CSP gets baked into
   `routes-manifest.json`.
3. Re-run `pnpm test:e2e` — spec `124-web-security-headers` asserts
   the CSP's shape; adjust the assertion if the directive list grew.

If the script needs inline execution (ads, analytics), consider
switching to a nonce-based CSP at that point rather than broadening
`'unsafe-inline'`.

## Verification

```sh
# API
curl -I http://localhost:3101/api/articles | grep -Ei 'x-content|x-frame|referrer|permissions'

# Web
curl -I http://localhost:3100/ | grep -Ei 'content-security|x-content|x-frame|referrer|permissions'
```

Expected:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), geolocation=(), microphone=()
Content-Security-Policy: default-src 'self'; ...
```

Against a live deploy: https://observatory.mozilla.org/ should score
at least a `B`. Lower grades usually mean the CSP missed a directive
the tool is looking for (e.g. `report-uri`) — those are nice-to-have,
not blocking.

## Related

- `docs/rate-limits.md` — rate + body-size floor (#116, #126).
- ADR 001 §"Security headers" — the tuning rationale.
