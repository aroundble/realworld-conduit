import { expect, request, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// BDD coverage for issue #4: register + login + current-user.
// Six scenarios from the issue body, executed against the compose API.
// Each scenario uses a unique email so runs don't depend on DB reset
// order — the only precondition is "database reachable + migrated".

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const SCREENSHOT_DIR = "tests/e2e/screenshots/4";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #4 — API auth (register / login / current-user)", () => {
  test("Scenario 1: register returns spec-shaped user envelope and sets cookie", async () => {
    const id = uniq();
    const api = await request.newContext({ baseURL: API_URL });
    const res = await api.post("/api/users", {
      data: {
        user: {
          username: `jake-${id}`,
          email: `jake-${id}@jake.jake`,
          password: "jakejake",
        },
      },
    });

    expect(res.status()).toBe(201);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user.email).toBe(`jake-${id}@jake.jake`);
    expect(body.user.username).toBe(`jake-${id}`);
    expect(body.user.bio).toBeNull();
    expect(body.user.image).toBeNull();
    expect(typeof body.user.token).toBe("string");
    expect((body.user.token as string).length).toBeGreaterThan(20);

    const setCookie = res.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("conduit_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain("Max-Age=604800");
    expect(res.headers()["authorization"]).toBe(`Token ${body.user.token}`);

    await mkdir(dirname(`${SCREENSHOT_DIR}/_keep`), { recursive: true });
  });

  test("Scenario 2: duplicate email returns 422 with spec-shaped error", async () => {
    const id = uniq();
    const api = await request.newContext({ baseURL: API_URL });
    const email = `dupe-${id}@jake.jake`;
    const first = await api.post("/api/users", {
      data: { user: { username: `one-${id}`, email, password: "jakejake" } },
    });
    expect(first.status()).toBe(201);

    const dup = await api.post("/api/users", {
      data: { user: { username: `two-${id}`, email, password: "jakejake" } },
    });
    expect(dup.status()).toBe(422);
    const body = (await dup.json()) as { errors: { email?: string[] } };
    expect(body.errors.email).toEqual(["has already been taken"]);
  });

  test("Scenario 3: login succeeds with correct credentials", async () => {
    const id = uniq();
    const api = await request.newContext({ baseURL: API_URL });
    const email = `login-ok-${id}@jake.jake`;
    await api.post("/api/users", {
      data: { user: { username: `loginok-${id}`, email, password: "jakejake" } },
    });

    const res = await api.post("/api/users/login", {
      data: { user: { email, password: "jakejake" } },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { user: { email: string; token: string } };
    expect(body.user.email).toBe(email);
    expect(typeof body.user.token).toBe("string");
    expect(res.headers()["set-cookie"] ?? "").toContain("conduit_session=");
  });

  test("Scenario 4: login fails with wrong password", async () => {
    const id = uniq();
    const api = await request.newContext({ baseURL: API_URL });
    const email = `login-bad-${id}@jake.jake`;
    await api.post("/api/users", {
      data: { user: { username: `loginbad-${id}`, email, password: "jakejake" } },
    });

    const res = await api.post("/api/users/login", {
      data: { user: { email, password: "wrongpass" } },
    });
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    // Spec envelope for wrong password: `{errors:{credentials:["invalid"]}}`.
    // Updated per #62 to match the canonical RealWorld Bruno collection.
    expect(body.errors.credentials).toEqual(["invalid"]);
    expect(res.headers()["set-cookie"]).toBeUndefined();
  });

  test("Scenario 5: GET /api/user returns the authenticated user (cookie carrier)", async () => {
    const id = uniq();
    const email = `me-${id}@jake.jake`;
    const username = `me-${id}`;
    const api = await request.newContext({ baseURL: API_URL });
    const register = await api.post("/api/users", {
      data: { user: { username, email, password: "jakejake" } },
    });
    expect(register.status()).toBe(201);
    // `request.newContext` tracks cookies from Set-Cookie automatically,
    // so the next call carries conduit_session without us naming it.

    const me = await api.get("/api/user");
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { user: Record<string, unknown> };
    expect(body.user.email).toBe(email);
    expect(body.user.username).toBe(username);
    expect(body.user.bio).toBeNull();
    expect(body.user.image).toBeNull();
  });

  test("Scenario 6: GET /api/user without auth returns 401", async () => {
    const api = await request.newContext({ baseURL: API_URL });
    const res = await api.get("/api/user");
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    // Spec envelope for missing/invalid token: `{errors:{token:["is missing"]}}`.
    // Updated per #62 to match the canonical RealWorld Bruno collection.
    expect(body.errors.token).toEqual(["is missing"]);
  });
});
