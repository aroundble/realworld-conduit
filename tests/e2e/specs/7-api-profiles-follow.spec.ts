import { expect, request, test } from "@playwright/test";

// BDD coverage for issue #7: GET /api/profiles/:username + POST/DELETE
// /:username/follow. Six scenarios from the issue body. Profile
// envelope shape is spec-literal: `{ profile: { username, bio, image,
// following } }`. The viewer's follow relationship is expressed via
// `following: boolean` (null-viewer → false).

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const register = async (api: ReturnType<typeof request.newContext> extends Promise<infer T> ? T : never, username: string) => {
  const res = await api.post("/api/users", {
    data: { user: { username, email: `${username}@jake.jake`, password: "jakejake" } },
  });
  expect(res.status()).toBe(201);
};

test.describe("issue #7 — API profiles (view + follow / unfollow)", () => {
  test("Scenario 1: anonymous profile view returns following=false", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const seedApi = await request.newContext({ baseURL: API_URL });
    await register(seedApi, jake);

    const anonApi = await request.newContext({ baseURL: API_URL });
    const res = await anonApi.get(`/api/profiles/${jake}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { profile: Record<string, unknown> };
    expect(body.profile.username).toBe(jake);
    expect(body.profile.bio).toBeNull();
    expect(body.profile.image).toBeNull();
    expect(body.profile.following).toBe(false);
  });

  test("Scenario 2: authenticated profile view reflects follow state", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await register(jakeApi, jake);
    await register(danApi, dan);

    // Before follow: dan sees following=false on jake's profile.
    const before = await danApi.get(`/api/profiles/${jake}`);
    expect(before.status()).toBe(200);
    expect(((await before.json()) as { profile: { following: boolean } }).profile.following).toBe(false);

    // After follow: following=true.
    const follow = await danApi.post(`/api/profiles/${jake}/follow`);
    expect(follow.status()).toBe(200);
    const after = await danApi.get(`/api/profiles/${jake}`);
    expect(((await after.json()) as { profile: { following: boolean } }).profile.following).toBe(true);
  });

  test("Scenario 3: follow and unfollow round-trip flips the flag", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    const danApi = await request.newContext({ baseURL: API_URL });
    await register(jakeApi, jake);
    await register(danApi, dan);

    const follow = await danApi.post(`/api/profiles/${jake}/follow`);
    expect(follow.status()).toBe(200);
    expect(((await follow.json()) as { profile: { following: boolean } }).profile.following).toBe(true);

    const unfollow = await danApi.delete(`/api/profiles/${jake}/follow`);
    expect(unfollow.status()).toBe(200);
    expect(((await unfollow.json()) as { profile: { following: boolean } }).profile.following).toBe(false);
  });

  test("Scenario 4: following a non-existent user returns 404", async () => {
    const id = uniq();
    const dan = `dan-${id}`;
    const danApi = await request.newContext({ baseURL: API_URL });
    await register(danApi, dan);

    const res = await danApi.post(`/api/profiles/nobody-${id}/follow`);
    expect(res.status()).toBe(404);
  });

  test("Scenario 5: cannot follow yourself → 422", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await request.newContext({ baseURL: API_URL });
    await register(jakeApi, jake);

    const res = await jakeApi.post(`/api/profiles/${jake}/follow`);
    expect(res.status()).toBe(422);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    expect(body.errors.profile).toEqual(["cannot follow yourself"]);
  });

  test("Scenario 6: follow endpoints require auth", async () => {
    const id = uniq();
    const jake = `jake-${id}`;
    const seedApi = await request.newContext({ baseURL: API_URL });
    await register(seedApi, jake);

    const anonApi = await request.newContext({ baseURL: API_URL });
    const res = await anonApi.post(`/api/profiles/${jake}/follow`);
    expect(res.status()).toBe(401);
  });
});
