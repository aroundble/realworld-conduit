import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";
import { runAxe } from "../axe-config";

// BDD coverage for issue #137 — editor draft autosave + restore.
// The hook writes title/description/body/tagList to localStorage
// every 3s (debounced) after last keystroke; a banner offers
// Keep / Discard on return.
//
// Test strategy: we evaluate page.evaluate to seed localStorage
// directly for the "return visit" scenarios rather than waiting
// on the 3s debounce — that keeps each test under a second and
// avoids slow-test flake. The first scenario does exercise the
// real debounce path so we're sure the hook actually writes.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

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

// Seed a draft into localStorage before navigation so the restore
// banner surfaces on first paint. Fast-path that avoids the 3s
// debounce; we verify the debounce separately in Scenario 1.
const seedDraft = async (
  context: BrowserContext,
  draft: {
    title: string;
    description: string;
    body: string;
    tagList: string[];
    minutesAgo?: number;
  },
  key: "conduit-draft-new" | `conduit-draft-edit-${string}` = "conduit-draft-new",
): Promise<void> => {
  const savedAt = Date.now() - (draft.minutesAgo ?? 1) * 60_000;
  await context.addInitScript(
    ({ key: k, payload }) => {
      try {
        window.localStorage.setItem(k, JSON.stringify(payload));
      } catch {
        /* private mode — ignore */
      }
    },
    {
      key,
      payload: {
        title: draft.title,
        description: draft.description,
        body: draft.body,
        tagList: draft.tagList,
        savedAt,
      },
    },
  );
};

test.describe("issue #137 — editor draft autosave", () => {
  test("Scenario 1: typing triggers a debounced write to localStorage", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `dr-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/editor`);
    // Wipe any draft left over from an earlier test in the same
    // worker — the default Playwright context shares storage.
    await page.evaluate(() =>
      window.localStorage.removeItem("conduit-draft-new"),
    );
    // Dismiss any restore banner from a previous test's draft so
    // the "new mode with empty form" assumption holds.
    const maybeBanner = page.getByTestId("draft-restore-banner");
    if ((await maybeBanner.count()) > 0) {
      await page.getByTestId("draft-discard").click();
    }
    await page.getByPlaceholder("Article Title").fill(`draft-${id}`);
    await page
      .getByPlaceholder("What's this article about?")
      .fill("desc-body");
    await page
      .getByPlaceholder("Write your article (in markdown)")
      .fill("mdbody");

    // Debounce is 3s; give it a 500ms buffer. No wall-clock-sensitive
    // alternative — the write *is* debounced by design.
    await page.waitForTimeout(3500);

    const stored = await page.evaluate(() =>
      window.localStorage.getItem("conduit-draft-new"),
    );
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored ?? "{}");
    expect(parsed.title).toBe(`draft-${id}`);
    expect(parsed.description).toBe("desc-body");
    expect(parsed.body).toBe("mdbody");
    expect(typeof parsed.savedAt).toBe("number");
  });

  test("Scenario 2: restore banner appears and Keep fills the form", async ({
    browser,
  }) => {
    const id = uniq();
    const jake = `dr-k-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);

    const context = await browser.newContext();
    await primeSession(context, session, jake);
    await seedDraft(context, {
      title: `restored-${id}`,
      description: "restored-desc",
      body: "restored-body",
      tagList: ["alpha"],
      minutesAgo: 2,
    });

    const page = await context.newPage();
    await page.goto(`${WEB_URL}/editor`);

    const banner = page.getByTestId("draft-restore-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Restored draft/);
    await expect(banner).toHaveAttribute("role", "status");

    await page.getByTestId("draft-keep").click();

    // Fields now carry the restored values; banner disappears.
    await expect(banner).toHaveCount(0);
    await expect(page.getByPlaceholder("Article Title")).toHaveValue(
      `restored-${id}`,
    );
    await expect(
      page.getByPlaceholder("What's this article about?"),
    ).toHaveValue("restored-desc");
    await expect(
      page.getByPlaceholder("Write your article (in markdown)"),
    ).toHaveValue("restored-body");

    await context.close();
  });

  test("Scenario 3: Discard clears the stored draft", async ({ browser }) => {
    const id = uniq();
    const jake = `dr-d-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);

    const context = await browser.newContext();
    await primeSession(context, session, jake);
    await seedDraft(context, {
      title: `trash-${id}`,
      description: "trash",
      body: "trash",
      tagList: [],
    });

    const page = await context.newPage();
    await page.goto(`${WEB_URL}/editor`);

    const banner = page.getByTestId("draft-restore-banner");
    await expect(banner).toBeVisible();
    await page.getByTestId("draft-discard").click();

    await expect(banner).toHaveCount(0);
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("conduit-draft-new"),
    );
    expect(stored).toBeNull();
    // Form fields remained empty (no Keep fired).
    await expect(page.getByPlaceholder("Article Title")).toHaveValue("");

    await context.close();
  });

  test("Scenario 4: successful submit clears the draft", async ({
    browser,
  }) => {
    const id = uniq();
    const jake = `dr-s-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);

    // Fresh context per scenario to avoid localStorage bleed from
    // the Scenario 1 debounce-write.
    const context = await browser.newContext();
    await primeSession(context, session, jake);
    const page = await context.newPage();

    await page.goto(`${WEB_URL}/editor`);
    // Ensure no stale draft banner surfaces even if the browser
    // storage leaked in (defensive — fresh context should suffice).
    await expect(page.getByTestId("draft-restore-banner")).toHaveCount(0);

    await page.getByPlaceholder("Article Title").fill(`sub-${id}`);
    await page
      .getByPlaceholder("What's this article about?")
      .fill("description for sub");
    await page
      .getByPlaceholder("Write your article (in markdown)")
      .fill("body for submit test");

    // Wait for the 3s debounce to persist once.
    await page.waitForTimeout(3500);
    const beforeSubmit = await page.evaluate(() =>
      window.localStorage.getItem("conduit-draft-new"),
    );
    expect(beforeSubmit).toBeTruthy();

    await page.getByRole("button", { name: /Publish Article/ }).click();

    // Server action redirects to /article/<slug> on success.
    await page.waitForURL(/\/article\//);

    const afterSubmit = await page.evaluate(() =>
      window.localStorage.getItem("conduit-draft-new"),
    );
    expect(afterSubmit).toBeNull();

    await context.close();
  });

  test("Scenario 5: edit-mode draft is scoped per slug (new-mode editor doesn't see it)", async ({
    browser,
  }) => {
    const id = uniq();
    const jake = `dr-e-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);

    const context = await browser.newContext();
    await primeSession(context, session, jake);
    // Seed a draft under an edit-mode key. The /editor (new-mode)
    // page should NOT show this banner because keys are per-slug.
    await seedDraft(
      context,
      {
        title: `edit-${id}`,
        description: "edit-desc",
        body: "edit-body",
        tagList: [],
      },
      "conduit-draft-edit-some-slug",
    );

    const page = await context.newPage();
    await page.goto(`${WEB_URL}/editor`);

    // No banner on the new-mode editor.
    await expect(page.getByTestId("draft-restore-banner")).toHaveCount(0);

    await context.close();
  });

  test("Scenario 6: axe a11y gate on editor with restore banner visible", async ({
    browser,
  }) => {
    const id = uniq();
    const jake = `dr-a-${id}`;
    const api = await apiContext();
    const session = await registerUser(api, jake);

    const context = await browser.newContext();
    await primeSession(context, session, jake);
    await seedDraft(context, {
      title: `axe-${id}`,
      description: "axe-desc",
      body: "axe-body",
      tagList: [],
    });

    const page = await context.newPage();
    await page.goto(`${WEB_URL}/editor`);
    await expect(page.getByTestId("draft-restore-banner")).toBeVisible();
    await runAxe(page);

    await context.close();
  });
});
