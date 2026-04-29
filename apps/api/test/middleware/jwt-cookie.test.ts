import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import jwt from "jsonwebtoken";

// Ensure the config + prisma modules see deterministic env before
// they're imported (both read process.env at module load time).
// DATABASE_URL only needs to satisfy the non-empty check in
// prisma/client.ts — these tests never touch the Prisma client.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://vitest:vitest@127.0.0.1:5/vitest";
process.env.JWT_SECRET = "test-only-secret";
process.env.JWT_TTL_SECONDS = "3600";
process.env.JWT_CLOCK_SKEW_SECONDS = "0";

const { COOKIE_NAME, optionalAuth, readBearer, requireAuth } = await import(
  "../../src/middleware/jwt-cookie.js"
);
const { errorHandler } = await import("../../src/middleware/error.js");

type TestPayload = { id: number; email: string; username: string };

const signToken = (payload: TestPayload, opts: jwt.SignOptions = {}): string =>
  jwt.sign(payload, process.env.JWT_SECRET!, {
    algorithm: "HS256",
    expiresIn: 3600,
    ...opts,
  });

const validPayload: TestPayload = {
  id: 42,
  email: "jake@example.com",
  username: "jake",
};

const buildApp = (variant: "strict" | "soft") => {
  const app = new Hono();
  app.onError(errorHandler as never);
  if (variant === "strict") {
    app.use("/me", requireAuth());
  } else {
    app.use("/me", optionalAuth());
  }
  app.get("/me", (c) => {
    const user = c.get("user" as never);
    return c.json({ user });
  });
  return app;
};

describe("readBearer — Authorization header parser", () => {
  it("returns the token when the header uses the spec's `Token` prefix", () => {
    expect(readBearer("Token abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("returns null for a missing header", () => {
    expect(readBearer(undefined)).toBeNull();
  });

  it("returns null for a header without the Token prefix (Bearer is rejected)", () => {
    expect(readBearer("Bearer abc.def.ghi")).toBeNull();
  });

  it("returns null when the prefix is present but the token is blank", () => {
    expect(readBearer("Token ")).toBeNull();
  });
});

describe("Scenario 1: Authenticated request exposes current user to handler", () => {
  beforeAll(() => {
    /* fixtures built per test */
  });

  it("attaches the verified payload to c.var.user under strict auth", async () => {
    const app = buildApp("strict");
    const token = signToken(validPayload);
    const res = await app.request("/me", {
      headers: { Authorization: `Token ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: TestPayload };
    expect(body.user).toEqual(validPayload);
  });

  it("reads a cookie-borne token the same way", async () => {
    const app = buildApp("strict");
    const token = signToken(validPayload);
    const res = await app.request("/me", {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: TestPayload };
    expect(body.user).toEqual(validPayload);
  });
});

describe("Scenario 2: Missing cookie on strict-auth returns 401", () => {
  it("returns 401 with the spec-shaped error envelope when no carrier is present", async () => {
    const app = buildApp("strict");
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { errors: { auth: string[] } };
    expect(body).toEqual({ errors: { auth: ["Unauthorized"] } });
  });
});

describe("Scenario 3: Expired JWT on strict-auth returns 401 and clears cookie", () => {
  it("returns 401 and sets Set-Cookie with Max-Age=0 for cookie-borne expired tokens", async () => {
    const app = buildApp("strict");
    const expired = signToken(validPayload, { expiresIn: -60 });
    const res = await app.request("/me", {
      headers: { Cookie: `${COOKIE_NAME}=${expired}` },
    });
    expect(res.status).toBe(401);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`${COOKIE_NAME}=;`));
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it("still 401s when the token is signed with the wrong secret", async () => {
    const app = buildApp("strict");
    const tampered = jwt.sign(validPayload, "different-secret", {
      algorithm: "HS256",
      expiresIn: 3600,
    });
    const res = await app.request("/me", {
      headers: { Cookie: `${COOKIE_NAME}=${tampered}` },
    });
    expect(res.status).toBe(401);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`${COOKIE_NAME}=;`));
  });
});

describe("Scenario 4: Soft-auth works for both anonymous and authenticated", () => {
  it("proceeds with user=null when no carrier is present", async () => {
    const app = buildApp("soft");
    const res = await app.request("/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: TestPayload | null };
    expect(body.user).toBeNull();
  });

  it("proceeds with user populated when the token is valid", async () => {
    const app = buildApp("soft");
    const token = signToken(validPayload);
    const res = await app.request("/me", {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: TestPayload };
    expect(body.user).toEqual(validPayload);
  });

  it("proceeds with user=null on a bad token — never 401s", async () => {
    const app = buildApp("soft");
    const res = await app.request("/me", {
      headers: { Cookie: `${COOKIE_NAME}=not-a-jwt` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: TestPayload | null };
    expect(body.user).toBeNull();
  });

  it("does NOT clear the cookie on a bad soft-auth token", async () => {
    const app = buildApp("soft");
    const res = await app.request("/me", {
      headers: { Cookie: `${COOKIE_NAME}=not-a-jwt` },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("Scenario 5: Authorization header precedes cookie when both are present and valid", () => {
  it("exposes the header user when header + cookie both decode cleanly", async () => {
    const app = buildApp("strict");
    const headerUser: TestPayload = {
      id: 100,
      email: "header@example.com",
      username: "header-user",
    };
    const cookieUser: TestPayload = {
      id: 200,
      email: "cookie@example.com",
      username: "cookie-user",
    };
    const res = await app.request("/me", {
      headers: {
        Authorization: `Token ${signToken(headerUser)}`,
        Cookie: `${COOKIE_NAME}=${signToken(cookieUser)}`,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: TestPayload };
    expect(body.user).toEqual(headerUser);
  });

  it("falls back to the cookie when the header is absent", async () => {
    const app = buildApp("strict");
    const res = await app.request("/me", {
      headers: { Cookie: `${COOKIE_NAME}=${signToken(validPayload)}` },
    });
    const body = (await res.json()) as { user: TestPayload };
    expect(body.user).toEqual(validPayload);
  });
});
