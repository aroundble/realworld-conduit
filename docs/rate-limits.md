# Rate + body-size limits (#116, #126)

The API has two reliability primitives that run before any route
handler: per-bucket rate limits (#116) and per-request body-size
caps (#126). Both are DoS shields; together they bound the worst-
case cost a misbehaving client can impose on the server.

## Rate limiting (#116)

Per-bucket fixed-window counter on every write endpoint. The goal is a
reliability floor — a misbehaving client can't exhaust DB connections
or spam an author's inbox with comments. Anonymous list reads stay
unlimited so the stranger-evaluates-the-spec path doesn't hit a cap.

## Storage

Postgres. A `RateLimit` row per `(bucket, key, windowStart)` tuple;
`hits` increments via `INSERT ... ON CONFLICT DO UPDATE SET hits =
hits + 1`. See `apps/api/src/middleware/rate-limit.ts`.

Why Postgres over Redis: we already run Postgres; keeping
single-dependency matches the Level-2 ladder's "no new infra"
constraint. Upsert contention at the expected request rate is <1ms;
Redis would be faster under true load but a new SPOF.

## Budgets

| Bucket | Endpoint(s) | Limit | Window | Key |
|---|---|---|---|---|
| `users:register` | `POST /api/users` | 5 | 60s | per-IP |
| `users:login` | `POST /api/users/login` | 10 | 60s | per-IP |
| `articles:write` | `POST/PUT/DELETE /api/articles`, `PUT/DELETE /api/articles/:slug` | 30 | 60s | per-user |
| `articles:favorite` | `POST/DELETE /api/articles/:slug/favorite` | 30 | 60s | per-user |
| `comments:post` | `POST /api/articles/:slug/comments` | 20 | 60s | per-user |
| `comments:delete` | `DELETE /api/articles/:slug/comments/:id` | 30 | 60s | per-user |
| `profiles:follow` | `POST/DELETE /api/profiles/:username/follow` | 30 | 60s | per-user |

Higher login ceiling than register is deliberate: typos on the auth
form shouldn't lock a legit user out. Per-user (not per-IP) on authed
writes so one user on a shared IP can't exhaust a colleague's budget.

## 429 response shape

```json
{ "errors": { "rate": ["too many requests, please try again later"] } }
```

Matches the existing spec422-style `{ errors: { <field>: [<msg>] } }`
envelope. Headers:

- `Retry-After: <seconds>` — time until the current window ends.
- `X-RateLimit-Limit: <n>` — the bucket's cap.
- `X-RateLimit-Remaining: 0`
- `X-RateLimit-Reset: <epoch-seconds>` — window end timestamp.

## Enable / disable knob

`RATE_LIMIT_ENABLED=1` turns the middleware on; any other value
(including unset) short-circuits it. Default is **off** so local
dev + the main Playwright suite run burst-writes without hitting
per-IP buckets.

## Deployment discipline

- **Production**: always `RATE_LIMIT_ENABLED=1` — the production
  compose / deployment env must set it explicitly. The default
  is off for dev ergonomics; any deploy that ships without the
  flag has no rate limiting at all.
- **CI**: the `rate-limit-spec` job in
  `.github/workflows/ci.yml` boots compose with
  `RATE_LIMIT_ENABLED=1` and runs only
  `tests/e2e/specs/116-api-rate-limit.spec.ts`. The `smoke` job
  leaves the flag off so the ~130 other specs stay green
  (running the full suite with the flag on exhausts per-IP
  budgets mid-run — ~40 registers in 60s). That split means
  (a) the middleware is exercised on every PR, (b) the rest
  of the suite stays fast.
- **Local spec 116 run**:
  ```sh
  RATE_LIMIT_ENABLED=1 $COMPOSE up -d --build --force-recreate api
  pnpm test:e2e:rate-limit
  ```
- **Bruno conformance**: leave the flag off. The canonical
  collection fires 50+ writes back-to-back and would false-fail
  under the live limits.

## Retuning

1. Grep `bucket:` in `apps/api/src/routes/*.ts` — every caller is a
   `rateLimit({...})` invocation.
2. Change `limit` or `windowSec` inline. No re-deploy of any
   consumer; the setting is per-route.
3. Bruno conformance + Playwright #116 spec re-run proves the new
   numbers.

If a bucket needs a whole different shape (per-session instead of
per-user, or per-article rather than per-user), extend
`RateLimitKeyStrategy` in `rate-limit.ts`.

## Cleanup

Old RateLimit rows (updatedAt < now - 24h) accumulate as buckets
rotate. A future cron can `DELETE FROM "RateLimit" WHERE "updatedAt"
< NOW() - INTERVAL '1 day'`. Not wired yet — row volume is low
enough that startup migration doesn't need to VACUUM. File an
issue when volume suggests otherwise.

## Body-size limits (#126)

A client cannot make the API allocate multi-megabyte buffers just
by posting a large body. Two tiers:

| Scope | Env | Default | Applies to |
|---|---|---|---|
| Global floor | `API_BODY_LIMIT_GLOBAL_KB` | 1024 (1 MB) | Every mutating request (POST/PUT/PATCH/DELETE with body) |
| Per-endpoint | `API_BODY_LIMIT_ARTICLE_KB` | 100 | `POST /api/articles`, `PUT /api/articles/:slug` |

Implementation wraps `hono/body-limit`. See
`apps/api/src/middleware/body-limit.ts`. The global cap is wired
in `apps/api/src/app.ts` via `app.use("*", globalBodyLimit())`;
the per-endpoint cap sits on the article create/update paths
before the rate-limit middleware so an oversized request
short-circuits with 413 without consuming from the write bucket.

### 413 response shape

```json
{ "errors": { "body": ["payload too large, max 100KB"] } }
```

The `errors.body[0]` message echoes the effective cap in KB so
clients can surface a useful error. Status is 413. No
`Retry-After` — this isn't transient; the client needs to resend
with a smaller body.

### Why two tiers?

- The 1 MB global floor catches the DoS axis — a drive-by that
  posts `{"x": "A".repeat(20_000_000)}` to any endpoint is
  rejected before Node allocates the string.
- The 100 KB article cap is a business ceiling — article body is
  the largest *legitimate* payload (long-form Markdown) and
  100 KB ≈ 50 pages of prose is an order of magnitude above any
  realistic post. Per-field zod caps (title.max(300),
  body.max(50_000)) remain authoritative for validation errors
  and surface as 422 with the usual envelope.

### Interaction with rate limiting

Body-limit runs before rate-limit on the article write routes.
Consequence: an oversized POST returns 413 and does **not**
consume from the write bucket. The ordering is deliberate — we
want clients to fix their payload and retry immediately, not to
also get rate-limited because their app is buggy.

### Disable knob

None. Body-limit is always on; the defaults are safe for dev,
CI, and production. The env vars exist only for per-env tuning
(e.g. bumping the article cap to 200 KB for a future long-form
demo).
