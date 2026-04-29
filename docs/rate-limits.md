# Rate limiting (#116)

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

## Disable knob

`RATE_LIMIT_ENABLED=0` short-circuits the middleware. Used by:

- Bruno conformance runs (50+ writes back-to-back within seconds).
- Local flake investigation.

Set at the env-var level on the API container. Default on (1).

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
