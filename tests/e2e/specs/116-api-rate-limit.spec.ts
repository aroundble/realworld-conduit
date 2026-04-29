import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #116 — per-IP + per-user rate limits on
// write endpoints.
//
// Each scenario bursts N+1 requests through the relevant endpoint
// and asserts the (N+1)-th gets a 429 with the spec-shaped body +
// Retry-After header. Per-user scenarios verify a separate user on
// the same IP is unaffected.
//
// To keep test wall-clock bounded, this spec lives inside the
// existing 60-second rate-limit window — no sleeps. Each test
// uses a fresh user / fresh IP equivalent (via a distinct email
// and a unique set of timestamps) so state from earlier tests
// doesn't bleed in.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Distinct synthetic IPs per test so per-IP buckets don't bleed
// across scenarios running back-to-back in the same process. The
// API middleware keys off X-Forwarded-For's head, so setting a
// unique value per test gives each its own per-IP bucket.
const fakeIp = (id: string) => `10.0.${(Number.parseInt(id.slice(-3), 10) || 0) % 250}.${(Number.parseInt(id.slice(-5, -3), 10) || 0) % 250}`;

const apiFor = async (id: string) => {
  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { "X-Forwarded-For": fakeIp(id) },
  });
};

// Minimal structural type for Playwright's APIResponse — we only need
// status(), json(), and headers() here.
type RlResponse = {
  status(): number;
  json(): Promise<unknown>;
  headers(): Record<string, string>;
};

const assertRateLimitResponse = async (res: RlResponse) => {
  expect(res.status()).toBe(429);
  const body = (await res.json()) as { errors: Record<string, string[]> };
  expect(body.errors.rate?.[0] ?? "").toContain("too many requests");
  const headers = res.headers();
  expect(headers["retry-after"]).toBeTruthy();
  expect(headers["x-ratelimit-remaining"]).toBe("0");
};

// Probes the API's /healthz to see whether the middleware is active.
// If the env flag is off on the running container, this spec skips —
// a running dev stack defaults to off so the rest of the Playwright
// suite's burst writes don't trip the per-IP buckets. CI wraps this
// spec in a separate run with RATE_LIMIT_ENABLED=1 on the API env.
test.describe("issue #116 — API rate limiting", () => {
  test.beforeAll(async () => {
    // Probe: make 6 register calls back-to-back; if the 6th is 429
    // the middleware is enabled; if it's 201 the middleware is off
    // and every scenario below is irrelevant (skip).
    const probe = await request.newContext({ baseURL: API_URL });
    const id = `probe-${Date.now()}`;
    let enabled = false;
    for (let i = 0; i < 6; i++) {
      const res = await probe.post("/api/users", {
        data: {
          user: {
            username: `probe-${id}-${i}`,
            email: `probe-${id}-${i}@jake.jake`,
            password: "jakejake",
          },
        },
      });
      if (res.status() === 429) {
        enabled = true;
        break;
      }
    }
    if (!enabled) {
      test.skip(
        true,
        "RATE_LIMIT_ENABLED is off on the API — this spec needs the middleware active. Set RATE_LIMIT_ENABLED=1 on the api compose env and restart before running.",
      );
    }
  });


  test("Scenario 1: register enforces 5/min/IP", async () => {
    // Each register call creates a distinct user — the throttle is
    // per-IP, not per-identity, so we can't accidentally sidestep
    // with a new email.
    const id = uniq();
    const api = await apiFor(id);

    for (let i = 0; i < 5; i++) {
      const res = await api.post("/api/users", {
        data: {
          user: {
            username: `rl-${id}-${i}`,
            email: `rl-${id}-${i}@jake.jake`,
            password: "jakejake",
          },
        },
      });
      expect(res.status()).toBe(201);
    }
    // 6th request trips the limit.
    const limited = await api.post("/api/users", {
      data: {
        user: {
          username: `rl-${id}-5`,
          email: `rl-${id}-5@jake.jake`,
          password: "jakejake",
        },
      },
    });
    await assertRateLimitResponse(limited);
  });

  test("Scenario 2: login enforces 10/min/IP", async () => {
    const id = uniq();
    const api = await apiFor(id);

    // Seed a user to log in as. Register goes through the register
    // bucket (5/min), and we only use 1 of those here, so this is
    // safe under the cap.
    const username = `rl-login-${id}`;
    const reg = await api.post("/api/users", {
      data: {
        user: {
          username,
          email: `${username}@jake.jake`,
          password: "jakejake",
        },
      },
    });
    expect(reg.status()).toBe(201);

    for (let i = 0; i < 10; i++) {
      const res = await api.post("/api/users/login", {
        data: {
          user: { email: `${username}@jake.jake`, password: "jakejake" },
        },
      });
      expect(res.status()).toBe(200);
    }
    const limited = await api.post("/api/users/login", {
      data: {
        user: { email: `${username}@jake.jake`, password: "jakejake" },
      },
    });
    await assertRateLimitResponse(limited);
  });

  test("Scenario 3: article-write enforces 30/min/user", async () => {
    const id = uniq();
    const jake = `rl-aw-${id}`;
    const api = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": fakeIp(id),
    });
    await api.registerUser(jake);

    // 30 creates succeed; the 31st trips 429.
    for (let i = 0; i < 30; i++) {
      await api.createArticleReturnSlug({ title: `rl-${id}-${i}` });
    }
    // Raw 31st — POP's wrapper expects 201 so bypass.
    const limited = await api.api.post("/api/articles", {
      data: {
        article: {
          title: `over ${id}`,
          description: "d",
          body: "b",
        },
      },
    });
    await assertRateLimitResponse(limited);
  });

  test("Scenario 3b: a second authed user on the same IP is unaffected", async () => {
    const id = uniq();
    const jake = `rl-j-${id}`;
    const dan = `rl-d-${id}`;
    // Deliberately SAME X-Forwarded-For so we're testing that the
    // per-user bucket dominates the per-IP bucket for authed writes.
    const sharedIp = fakeIp(id);
    const jakeApi = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": sharedIp,
    });
    const danApi = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": sharedIp,
    });
    await jakeApi.registerUser(jake);
    await danApi.registerUser(dan);

    // Jake burns 30 of jake's budget.
    for (let i = 0; i < 30; i++) {
      await jakeApi.createArticleReturnSlug({ title: `j-${id}-${i}` });
    }
    // Jake's 31st is limited...
    const jakeLimited = await jakeApi.api.post("/api/articles", {
      data: { article: { title: `j-over ${id}`, description: "d", body: "b" } },
    });
    expect(jakeLimited.status()).toBe(429);

    // ... but dan can still create articles (per-user bucket).
    const danOk = await danApi.createArticleReturnSlug({
      title: `d-${id}-still-works`,
    });
    expect(danOk).toMatch(/^d-/);
  });

  test("Scenario 4: comment-post enforces 20/min/user", async () => {
    const id = uniq();
    const jake = `rl-c-${id}`;
    const api = await ArticlesApi.newContext(undefined, {
      "X-Forwarded-For": fakeIp(id),
    });
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `rl-c-${id}` });

    for (let i = 0; i < 20; i++) {
      const res = await api.api.post(`/api/articles/${slug}/comments`, {
        data: { comment: { body: `c-${i}` } },
      });
      expect(res.status()).toBe(201);
    }
    const limited = await api.api.post(`/api/articles/${slug}/comments`, {
      data: { comment: { body: "over" } },
    });
    await assertRateLimitResponse(limited);
  });

  test("Scenario 5: anonymous list reads are unlimited", async () => {
    const id = uniq();
    const api = await apiFor(id);
    // Pick a number comfortably above every per-write cap. 60 is 2×
    // the tightest write cap (30/min); if list were accidentally
    // subject to any bucket this would 429.
    for (let i = 0; i < 60; i++) {
      const res = await api.get("/api/articles?limit=5");
      expect(res.status()).toBe(200);
    }
  });
});
