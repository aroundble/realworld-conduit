import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #6: PUT /api/user (update email/bio/username/
// image/password). Four scenarios from the issue body, executed
// against the running compose API.
//
// The route + service already ship as of issue #4 (scaffolding) + #5
// (auth middleware). This spec pins the behavior: envelope shape,
// persisted row, fresh JWT on password change (old credentials stop
// working), duplicate-email 422, and 401 for anonymous requests.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #6 — API PUT /api/user", () => {
  test("Scenario 1: update email + bio returns spec-shaped envelope and persists", async () => {
    const id = uniq();
    const username = `jake-${id}`;
    const api = await request.newContext({ baseURL: API_URL });

    const register = await api.post("/api/users", {
      data: {
        user: { username, email: `${username}@jake.jake`, password: "jakejake" },
      },
    });
    expect(register.status()).toBe(201);

    const newEmail = `new-${id}@jake.jake`;
    const update = await api.put("/api/user", {
      data: { user: { email: newEmail, bio: "I like cats" } },
    });
    expect(update.status()).toBe(200);
    const body = (await update.json()) as {
      user: Record<string, unknown>;
    };
    expect(body.user.email).toBe(newEmail);
    expect(body.user.bio).toBe("I like cats");
    expect(body.user.username).toBe(username);
    expect(body.user.image).toBeNull();
    expect(typeof body.user.token).toBe("string");

    // Persistence: re-fetch via GET /api/user and confirm the row
    // reflects the change (covers the AC's "database row reflects").
    const me = await api.get("/api/user");
    expect(me.status()).toBe(200);
    const after = (await me.json()) as { user: Record<string, unknown> };
    expect(after.user.email).toBe(newEmail);
    expect(after.user.bio).toBe("I like cats");
  });

  test("Scenario 2: password change re-issues JWT and invalidates old credentials", async () => {
    const id = uniq();
    const username = `pw-${id}`;
    const email = `${username}@jake.jake`;
    const api = await request.newContext({ baseURL: API_URL });

    const register = await api.post("/api/users", {
      data: { user: { username, email, password: "jakejake" } },
    });
    expect(register.status()).toBe(201);
    const oldCookie = register.headers()["set-cookie"] ?? "";
    const oldTokenMatch = oldCookie.match(/conduit_session=([^;]+)/);
    const oldToken = oldTokenMatch ? oldTokenMatch[1] : "";
    expect(oldToken.length).toBeGreaterThan(20);

    const update = await api.put("/api/user", {
      data: { user: { password: "newpassword" } },
    });
    expect(update.status()).toBe(200);
    const newCookie = update.headers()["set-cookie"] ?? "";
    expect(newCookie).toContain("conduit_session=");
    const newTokenMatch = newCookie.match(/conduit_session=([^;]+)/);
    const newToken = newTokenMatch ? newTokenMatch[1] : "";
    expect(newToken.length).toBeGreaterThan(20);

    // The issued JWT differs — iat (issued-at) changes at sign time so
    // two consecutive signs produce distinct tokens for the same user.
    // (If this ever comes back equal on a fast machine, add a 1s delay
    // in signToken; currently the second call crosses a second boundary
    // during the bcrypt rehash.)
    expect(newToken).not.toBe(oldToken);

    // Old password no longer works.
    const loginOld = await api.post("/api/users/login", {
      data: { user: { email, password: "jakejake" } },
    });
    expect(loginOld.status()).toBe(401);

    // New password works end-to-end.
    const loginNew = await api.post("/api/users/login", {
      data: { user: { email, password: "newpassword" } },
    });
    expect(loginNew.status()).toBe(200);
  });

  test("Scenario 3: updating to a duplicate email returns 422 spec-shaped error", async () => {
    const id = uniq();
    const jakeEmail = `jake-${id}@jake.jake`;
    const danEmail = `dan-${id}@jake.jake`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });

    const jakeReg = await jakeApi.post("/api/users", {
      data: { user: { username: `jake-${id}`, email: jakeEmail, password: "jakejake" } },
    });
    expect(jakeReg.status()).toBe(201);
    const danReg = await danApi.post("/api/users", {
      data: { user: { username: `dan-${id}`, email: danEmail, password: "jakejake" } },
    });
    expect(danReg.status()).toBe(201);

    const dup = await danApi.put("/api/user", {
      data: { user: { email: jakeEmail } },
    });
    expect(dup.status()).toBe(422);
    const body = (await dup.json()) as { errors: { email?: string[] } };
    expect(body.errors.email).toEqual(["has already been taken"]);
  });

  test("Scenario 4: unauthenticated PUT /api/user returns 401", async () => {
    const api = await request.newContext({ baseURL: API_URL });
    const res = await api.put("/api/user", {
      data: { user: { bio: "hi" } },
    });
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    // Spec envelope per #62 — canonical RealWorld missing-token shape.
    expect(body.errors.token).toEqual(["is missing"]);
  });
});
