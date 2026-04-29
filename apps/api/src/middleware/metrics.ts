import client from "prom-client";
import { createMiddleware } from "hono/factory";

// Prometheus metrics (#139). Level-2 observability ladder: SRE
// dashboards + alerting depend on scraping /metrics. We use the
// canonical `prom-client` library (Node standard, MIT) and register
// metrics on a dedicated Registry so tests can flush state deterministically.
//
// Cardinality discipline: every label comes from a bounded set (HTTP
// method, route pattern, status, rate-limit bucket, auth-failure
// reason). Never label by user id, slug, IP, or any unbounded
// value — Prometheus storage scales with label cardinality, so a
// slug-labeled counter is the single most common way to blow up a
// time-series database.

export const metricsRegistry = new client.Registry();

// Default process metrics (event-loop lag, GC, memory, CPU, file
// descriptors, etc.). Low-cardinality, cheap, and every Grafana
// dashboard template expects them. `register` is set so they route
// into OUR registry, not the global default — keeps test resets
// from clobbering state outside the API.
client.collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Count of HTTP requests processed, labelled by method, route pattern, and status.",
  labelNames: ["method", "route", "status"],
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds, labelled by method, route pattern, and status.",
  labelNames: ["method", "route", "status"],
  // Buckets tuned for a fast JSON API — most requests finish under
  // 100ms, so the lower buckets give us the detail that matters.
  // AC enumerates the minimum set; we match exactly.
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const httpRequestsInflight = new client.Gauge({
  name: "http_requests_inflight",
  help: "Current number of HTTP requests being processed.",
  registers: [metricsRegistry],
});

export const rateLimitRejectionsTotal = new client.Counter({
  name: "rate_limit_rejections_total",
  help: "Count of 429 rate-limit rejections, labelled by the bucket that tripped.",
  labelNames: ["endpoint"],
  registers: [metricsRegistry],
});

export const authFailuresTotal = new client.Counter({
  name: "auth_failures_total",
  help: "Count of authentication failures (register/login 4xx), labelled by reason.",
  labelNames: ["reason"],
  registers: [metricsRegistry],
});

// DB pool gauge — Prisma's adapter doesn't expose live pool counts
// in a stable API as of 7.x, so we emit 0s as a placeholder. When
// Prisma ships a usable introspection surface (or we swap to
// pg-pool directly), swap the value source here.
//
// Emitting the metric family with placeholder values keeps the
// Grafana dashboard contract stable: scrapers see the names they
// expect and plot "0 active" rather than "metric missing".
export const dbPoolConnections = new client.Gauge({
  name: "db_pool_connections",
  help: "Database connection pool gauge, labelled by state (active/idle). Placeholder until Prisma exposes pool stats.",
  labelNames: ["state"],
  registers: [metricsRegistry],
  collect() {
    this.set({ state: "active" }, 0);
    this.set({ state: "idle" }, 0);
  },
});

// Per-request instrumentation. Runs after request-id so the route
// pattern is known (Hono sets `c.req.routePath` when the match
// resolves), and closes over the timer/in-flight gauge so every
// path — success, zod-422, rate-limit-429, thrown-500 — gets
// counted exactly once.
export const metricsMiddleware = () =>
  createMiddleware(async (c, next) => {
    // Never instrument /metrics itself — a scraper hitting every 15s
    // would dominate the counters and bias the route histogram.
    if (c.req.path === "/metrics") {
      await next();
      return;
    }
    const method = c.req.method;
    httpRequestsInflight.inc();
    const endTimer = httpRequestDurationSeconds.startTimer();
    try {
      await next();
    } finally {
      // `routePath` is populated once the router matches; falls back
      // to the literal path for unmatched 404s. Unmatched paths
      // share a single "not-found" bucket so we don't balloon
      // cardinality on random probe URLs.
      const route = c.req.routePath || "not-found";
      const status = String(c.res.status);
      const labels = { method, route, status };
      httpRequestsTotal.inc(labels);
      endTimer(labels);
      httpRequestsInflight.dec();
    }
  });

// Prometheus text exposition with an optional token gate. The env
// is read lazily (per request) so tests can flip NODE_ENV and
// METRICS_TOKEN at will without re-importing the module.
export const metricsHandler = async (): Promise<{
  body: string;
  contentType: string;
}> => {
  const body = await metricsRegistry.metrics();
  return { body, contentType: metricsRegistry.contentType };
};

export const isMetricsAuthorized = (token: string | undefined): boolean => {
  // Non-prod: no gate. Local compose, CI, and dev environments
  // don't wire a secret; the convenience matters more than the
  // negligible local leak risk (issue AC scenario 4).
  if (process.env.NODE_ENV !== "production") return true;
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    // Misconfigured prod (no token set). Fail closed.
    return false;
  }
  return token === expected;
};
