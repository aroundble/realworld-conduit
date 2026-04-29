import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #139 — Prometheus /metrics endpoint.
// Dev mode is token-less; prod requires X-Metrics-Token. Tests
// exercise the dev path because compose ships NODE_ENV=development.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const fetchMetrics = async (): Promise<string> => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${API_URL}/metrics`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"] ?? "").toMatch(/text\/plain/);
  return res.text();
};

// Count a labelled counter value by summing all matching series in
// the Prometheus exposition text. Simple regex — AC cares about
// movement, not absolute numbers (baseline varies per run).
const counterSum = (body: string, metricName: string): number => {
  const pattern = new RegExp(`^${metricName}(\\{[^}]*\\})? (\\d+(?:\\.\\d+)?)`, "gm");
  let total = 0;
  for (const m of body.matchAll(pattern)) total += Number(m[2]);
  return total;
};

test.describe("issue #139 — /metrics Prometheus endpoint", () => {
  test("Scenario 1: /metrics returns Prometheus text with every required family", async () => {
    // Seed a little traffic first so counters + histograms aren't
    // empty for this fresh process.
    const ctx = await request.newContext();
    await ctx.get(`${API_URL}/api/tags`);
    await ctx.get(`${API_URL}/api/articles?limit=1`);

    const body = await fetchMetrics();

    // Six required families (AC scenario 1 + planner's list).
    expect(body).toMatch(/# TYPE http_requests_total counter/);
    expect(body).toMatch(/# TYPE http_request_duration_seconds histogram/);
    expect(body).toMatch(/# TYPE http_requests_inflight gauge/);
    expect(body).toMatch(/# TYPE db_pool_connections gauge/);
    expect(body).toMatch(/# TYPE rate_limit_rejections_total counter/);
    expect(body).toMatch(/# TYPE auth_failures_total counter/);

    // Histogram must cover the AC-enumerated buckets.
    for (const le of ["0.01", "0.05", "0.1", "0.25", "0.5", "1", "2.5", "5", "10"]) {
      expect(body).toContain(`le="${le}"`);
    }
  });

  test("Scenario 2: route label uses the pattern, not the interpolated slug", async () => {
    // Hit a slug-bearing route so we'd see a leak if the label
    // interpolated.
    const id = uniq();
    const jake = `m-r-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `route-${id}` });

    const ctx = await request.newContext();
    await ctx.get(`${API_URL}/api/articles/${slug}`);

    const body = await fetchMetrics();
    // The pattern (Hono-style ":slug") must appear.
    expect(body).toMatch(/route="\/api\/articles\/:slug"/);
    // The interpolated slug must NEVER appear as a label value.
    expect(body).not.toContain(`route="/api/articles/${slug}"`);
  });

  test("Scenario 3: http_requests_total increments per served request", async () => {
    const before = counterSum(await fetchMetrics(), "http_requests_total");

    const ctx = await request.newContext();
    // A handful of deterministic hits.
    for (let i = 0; i < 5; i++) {
      await ctx.get(`${API_URL}/api/tags`);
    }

    const after = counterSum(await fetchMetrics(), "http_requests_total");
    expect(after - before).toBeGreaterThanOrEqual(5);
  });

  test("Scenario 4: auth_failures_total increments on invalid login", async () => {
    const before = counterSum(await fetchMetrics(), "auth_failures_total");

    // Invalid credentials → AuthError("credentials", "invalid", 401).
    const ctx = await request.newContext();
    await ctx.post(`${API_URL}/api/users/login`, {
      data: {
        user: { email: "nobody-present@jake.jake", password: "jakejake" },
      },
    });

    const after = counterSum(await fetchMetrics(), "auth_failures_total");
    expect(after - before).toBeGreaterThanOrEqual(1);
  });

  test("Scenario 5: histogram duration buckets populate", async () => {
    // Any request will populate at least one bucket; confirm the
    // counts are moving for the sum-column.
    const ctx = await request.newContext();
    await ctx.get(`${API_URL}/api/articles?limit=1`);
    await ctx.get(`${API_URL}/api/tags`);

    const body = await fetchMetrics();
    const sumMatch = body.match(/http_request_duration_seconds_sum\{[^}]*\} (\d+(?:\.\d+)?)/);
    expect(sumMatch).toBeTruthy();
    const sum = Number(sumMatch![1]);
    expect(sum).toBeGreaterThan(0);
  });
});
