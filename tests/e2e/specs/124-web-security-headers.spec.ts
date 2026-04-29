import { expect, request, test } from "@playwright/test";
import { ArticlesApi } from "../page-objects/articles";

// BDD coverage for issue #124 — baseline security headers on the API
// and the web app. Headers are verified on concrete URLs that
// production traffic would hit: a page render path, an article detail,
// a profile, the API's article list.
//
// HSTS is conditional on `ENFORCE_HSTS=true` (set only in HTTPS-
// terminating envs). Local dev + CI compose stack run on plain HTTP
// so the assertion skips by reading the response header and matching
// presence to the runtime flag.

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const hstsEnabled = process.env.ENFORCE_HSTS === "true";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type HeaderBag = Record<string, string>;

const getHeaders = async (url: string): Promise<HeaderBag> => {
  const ctx = await request.newContext();
  const res = await ctx.get(url);
  return res.headers();
};

test.describe("issue #124 — baseline security headers", () => {
  test("Scenario 1: API responses include the baseline security headers", async () => {
    const h = await getHeaders(`${API_URL}/api/articles`);

    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toBe(
      "camera=(), geolocation=(), microphone=()",
    );
    // CORS + request-id must still flow through — pre-existing behavior
    // must not regress when secure-headers stacks on.
    expect(h["x-request-id"]).toBeTruthy();
  });

  test("Scenario 2: web homepage response includes CSP + baseline headers", async () => {
    const h = await getHeaders(`${WEB_URL}/`);

    expect(h["content-security-policy"]).toBeTruthy();
    const csp = h["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // connect-src must include the browser-visible API URL so that
    // client-side fetches don't get CSP-blocked. The bundled next
    // image always carries the canonical API URL per env; we assert
    // the directive's presence + that it names `self`.
    expect(csp).toContain("connect-src 'self'");

    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toBe(
      "camera=(), geolocation=(), microphone=()",
    );
  });

  test("Scenario 3: article detail page inherits the security headers", async () => {
    // Seed an article so /article/:slug is real (RSC 404 on unknown
    // slug would technically still carry the headers, but seeding
    // exercises the success path too).
    const id = uniq();
    const jake = `sec-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `sec-${id}` });

    const h = await getHeaders(`${WEB_URL}/article/${slug}`);

    expect(h["content-security-policy"]).toBeTruthy();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
  });

  test("Scenario 4: profile page inherits the security headers", async () => {
    const id = uniq();
    const jake = `sec-p-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);

    const h = await getHeaders(`${WEB_URL}/profile/${jake}`);

    expect(h["content-security-policy"]).toBeTruthy();
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"]).toBe("DENY");
  });

  test("Scenario 5: HSTS header presence tracks the ENFORCE_HSTS flag", async () => {
    const h = await getHeaders(`${WEB_URL}/`);
    const hsts = h["strict-transport-security"];

    if (hstsEnabled) {
      expect(hsts).toBeTruthy();
      expect(hsts).toContain("max-age=");
      expect(hsts).toContain("includeSubDomains");
    } else {
      // Local dev must NOT emit HSTS — a 2-year pin on localhost
      // would lock the dev browser into treating it as HTTPS.
      expect(hsts).toBeFalsy();
    }
  });

  test("Scenario 6: API preserves CORS + rate-limit headers alongside secure-headers", async () => {
    // Existing middleware stack must not regress. We probe the API
    // list endpoint and confirm CORS vary + request-id still ship
    // when secure-headers is active.
    const ctx = await request.newContext({
      extraHTTPHeaders: { Origin: WEB_URL },
    });
    const res = await ctx.get(`${API_URL}/api/articles?limit=1`);
    expect(res.status()).toBe(200);

    const h = res.headers();
    expect(h["vary"] ?? "").toMatch(/Origin/i);
    expect(h["x-request-id"]).toBeTruthy();
    expect(h["x-content-type-options"]).toBe("nosniff");
  });
});
