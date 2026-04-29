# Observability (#25, #139)

Three surfaces make the API observable in production:

| Surface | Purpose | Introduced |
|---|---|---|
| Structured pino JSON logs (stdout) | Per-request line with `requestId`, path, status, duration | #25 |
| `/healthz` | Liveness probe + DB round-trip check | #25 |
| `/metrics` | Prometheus-format metrics for SRE dashboards + alerting | #139 |

This doc covers `/metrics`. Logging + healthz are described inline in their own middleware modules.

## Metric families

Scrape `GET http://<api-host>/metrics`. Response is
`text/plain; version=0.0.4; charset=utf-8` — the canonical
Prometheus exposition format.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status` | Total requests served, per HTTP method + route pattern + status. |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` | Request duration in seconds. Buckets: 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10. |
| `http_requests_inflight` | gauge | — | Requests currently being processed. |
| `db_pool_connections` | gauge | `state` (`active`/`idle`) | Database connection pool stats. **Placeholder 0s** until Prisma 7.x exposes pool introspection. |
| `rate_limit_rejections_total` | counter | `endpoint` | Count of 429s emitted by the rate-limit middleware, by bucket name (`users:register`, `articles:write`, etc.). |
| `auth_failures_total` | counter | `reason` | Auth failures by stable reason: `invalid_credentials`, `missing_or_expired_token`, `email_conflict`, `username_conflict`, `other`. |

Plus the standard `process_*` and `nodejs_*` families from
`prom-client`'s default collector (CPU, RSS, GC, event-loop lag,
heap, file descriptors).

## Cardinality discipline

**The `route` label is the matched pattern, not the interpolated
URL.** Hono's `c.req.routePath` returns `/api/articles/:slug` — we
label with that, not `/api/articles/my-great-post`. The latter
would blow up Prometheus storage proportionally to the number of
distinct slugs ever fetched, which is unbounded.

Same discipline on the other labels:

- `status` — one of ~10 HTTP codes we emit; bounded.
- `method` — seven HTTP verbs; bounded.
- `endpoint` on `rate_limit_rejections_total` — the `bucket` name
  set at middleware configuration time; bounded by the number of
  distinct rate-limit buckets we define (currently 7).
- `reason` on `auth_failures_total` — five stable tokens, not the
  raw `AuthError` detail string.

If you add a new labelled metric, think "could a user action
create a new label value?" — if yes, stop and redesign. This is
the single most common mistake with Prometheus metrics.

## Local scraping

```sh
curl -s http://localhost:3101/metrics | head -40
```

Dev mode (`NODE_ENV=development` or `test`) is token-less — the
convenience matters more than the negligible local-leak risk. Any
scraper on the compose network can fetch.

## Production scraping

Production (`NODE_ENV=production`) requires an `X-Metrics-Token`
header. The server compares against `METRICS_TOKEN` env; if the
env is unset, `/metrics` is closed (fail-closed on
misconfiguration, not open).

```sh
curl -H "X-Metrics-Token: $METRICS_TOKEN" https://api.example/metrics
```

Set `METRICS_TOKEN` to a long random value per env (32+ chars);
rotate with the same cadence you rotate other ops secrets. The
token is scraper-facing, not user-facing — a breach leaks metric
shape, not data.

## Grafana dashboard shape

Not shipped here — file a follow-up once ops defines the alerting
thresholds. Minimum useful panels:

1. **Request rate**: `sum(rate(http_requests_total[1m])) by (route, status)`.
2. **p95 latency per route**: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))`.
3. **Error ratio**: `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`.
4. **Rate-limit rejections**: `sum(rate(rate_limit_rejections_total[5m])) by (endpoint)`.
5. **Auth failure rate**: `sum(rate(auth_failures_total[5m])) by (reason)` — alert on `invalid_credentials` burst.
6. **In-flight gauge**: `http_requests_inflight` — back-pressure signal.

Alerting suggestions:

- Page when p95 latency on `/api/articles/:slug` exceeds 500ms for 5 minutes.
- Page when 5xx ratio on any route exceeds 0.01 for 3 minutes.
- Page when `invalid_credentials` > 20/min for 5 minutes (credential-stuffing signal).

## Future work

- Swap the `db_pool_connections` placeholder for real Prisma pool
  stats when the Prisma team ships an introspection surface.
  Tracked as a code comment in `middleware/metrics.ts`.
- OpenTelemetry tracing is a different axis — see a separate issue
  if distributed-tracing becomes a requirement.
- A Grafana dashboard JSON + Prometheus scrape-config example
  belongs in a dedicated ops repo when one exists.
