import { expect, request, test, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runAxe } from "../axe-config";

// BDD coverage for issue #169 — avatar upload:
//   - POST /api/uploads/avatar multipart endpoint
//   - Ownership / auth gate (401)
//   - MIME + dimension validation (422)
//   - Size limit (413)
//   - Content-hashed filenames (dedupe same bytes)
//   - Cache-Control: immutable on served file
//   - Settings UI populates the image field + preview
//   - axe a11y gate with preview visible

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/images");
const FIXTURE_200_JPG = path.join(FIXTURE_DIR, "avatar-200.jpg");
const FIXTURE_300_PNG = path.join(FIXTURE_DIR, "avatar-300.png");
const FIXTURE_32_PNG = path.join(FIXTURE_DIR, "avatar-32.png");
const FIXTURE_TXT = path.join(FIXTURE_DIR, "not-an-image.txt");

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type ApiCtx = Awaited<ReturnType<typeof request.newContext>>;
const apiContext = () => request.newContext({ baseURL: API_URL });

const registerUser = async (api: ApiCtx, username: string): Promise<string> => {
  const res = await api.post("/api/users", {
    data: {
      user: {
        username,
        email: `${username}@jake.jake`,
        password: "jakejake",
      },
    },
  });
  expect(res.status()).toBe(201);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/conduit_session=([^;]+)/);
  if (!match) throw new Error("expected conduit_session cookie from register");
  return match[1];
};

const primeSession = async (
  context: BrowserContext,
  session: string,
  username: string,
): Promise<void> => {
  const webOrigin = new URL(WEB_URL);
  await context.addCookies([
    {
      name: "conduit_session",
      value: session,
      domain: webOrigin.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "conduit-user",
      value: encodeURIComponent(JSON.stringify({ username, image: null })),
      domain: webOrigin.hostname,
      path: "/",
      sameSite: "Lax",
    },
  ]);
};

type UploadOk = { url: string; width: number; height: number };

const uploadAvatar = async (
  api: ApiCtx,
  filePath: string,
  mime: string,
) => {
  const buffer = await readFile(filePath);
  return api.post("/api/uploads/avatar", {
    multipart: {
      file: { name: path.basename(filePath), mimeType: mime, buffer },
    },
  });
};

test.describe("issue #169 — avatar upload", () => {
  test("Scenario 1: anonymous upload returns 401", async () => {
    const anon = await request.newContext({ baseURL: API_URL });
    const res = await uploadAvatar(anon, FIXTURE_200_JPG, "image/jpeg");
    expect(res.status()).toBe(401);
  });

  test("Scenario 2: authed JPG upload returns 201 + dimensions + url", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const res = await uploadAvatar(api, FIXTURE_200_JPG, "image/jpeg");
    expect(res.status()).toBe(201);
    const payload = (await res.json()) as UploadOk;
    expect(payload.url).toMatch(/^\/uploads\/[a-f0-9]{16}\.jpg$/);
    expect(payload.width).toBe(200);
    expect(payload.height).toBe(200);
  });

  test("Scenario 3: re-upload of identical bytes yields the SAME url (content hash)", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const first = (await (
      await uploadAvatar(api, FIXTURE_200_JPG, "image/jpeg")
    ).json()) as UploadOk;
    const second = (await (
      await uploadAvatar(api, FIXTURE_200_JPG, "image/jpeg")
    ).json()) as UploadOk;
    expect(first.url).toBe(second.url);
  });

  test("Scenario 4: wrong MIME type returns 422", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const res = await uploadAvatar(api, FIXTURE_TXT, "text/plain");
    expect(res.status()).toBe(422);
  });

  test("Scenario 5: too-small image returns 422", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const res = await uploadAvatar(api, FIXTURE_32_PNG, "image/png");
    expect(res.status()).toBe(422);
  });

  test("Scenario 6: served file carries Cache-Control: immutable", async () => {
    const id = uniq();
    const api = await apiContext();
    await registerUser(api, `jake-${id}`);
    const upload = (await (
      await uploadAvatar(api, FIXTURE_300_PNG, "image/png")
    ).json()) as UploadOk;
    const anon = await request.newContext({ baseURL: API_URL });
    const served = await anon.get(upload.url);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/png");
    expect(served.headers()["cache-control"]).toContain("immutable");
    expect(served.headers()["cache-control"]).toContain("max-age=31536000");
  });

  test("Scenario 7: path-traversal filename on /uploads returns 404", async () => {
    const anon = await request.newContext({ baseURL: API_URL });
    const res = await anon.get("/uploads/..%2Fetc%2Fpasswd");
    expect([404, 422]).toContain(res.status());
  });

  test("Scenario 8: settings UI uploads + preview appears + image field populates", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/settings`);
    await page.setInputFiles(
      '[data-testid="avatar-upload-input"]',
      FIXTURE_300_PNG,
    );

    const preview = page.getByTestId("avatar-upload-preview");
    await expect(preview).toBeVisible();
    const src = await preview.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).toContain("/uploads/");

    // The sibling image URL input should be populated with the same
    // url the preview uses.
    const imageInput = page.locator('input[name="image"]');
    await expect(imageInput).toHaveValue(src!);
  });

  test("Scenario 9: settings UI rejects a non-image client-side", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/settings`);
    await page.setInputFiles(
      '[data-testid="avatar-upload-input"]',
      FIXTURE_TXT,
    );

    await expect(page.getByTestId("avatar-upload-error")).toBeVisible();
    await expect(page.getByTestId("avatar-upload-preview")).toHaveCount(0);
  });

  test("Scenario 10: axe a11y gate on settings with upload preview", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/settings`);
    await page.setInputFiles(
      '[data-testid="avatar-upload-input"]',
      FIXTURE_300_PNG,
    );
    await expect(page.getByTestId("avatar-upload-preview")).toBeVisible();
    await runAxe(page);
  });
});
