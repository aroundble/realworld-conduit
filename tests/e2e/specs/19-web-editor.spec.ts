import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";
import { runAxe } from "../axe-config";
import { EditorPage } from "../page-objects/editor";

// BDD coverage for issue #19: editor page (create + edit).
//
// Every DOM selector for /editor + /editor/[slug] lives in
// EditorPage (tests/e2e/page-objects/editor.ts). #98 Phase 2 refactor.
//
// Fixture note: Scenarios 1-4 all authenticate a fresh user and
// exercise the editor form — fixture-eligible in principle. Kept
// inline here because Scenario 4's Prisma row seeding (article
// authored by the authed user) needs the user's username known
// ahead of seeding; the fixture makes that awkward. Scenario 5
// needs two users (dan editing jake's article) — inline. Scenario
// 6 is anon — n/a. Future refactors can migrate Scenarios 1-3
// once EditorPage exposes a "for the authed user" helper.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

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

const createArticle = async (
  api: ApiCtx,
  title: string,
  tagList: string[] = [],
): Promise<string> => {
  const res = await api.post("/api/articles", {
    data: {
      article: { title, description: "d", body: "b", tagList },
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { article: { slug: string } }).article.slug;
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

test.describe("issue #19 — editor", () => {
  test("Scenario 1: create a new article end-to-end", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const editor = new EditorPage(page);
    await editor.gotoCreate(WEB_URL);
    await editor.fillForm({
      title: `Did you train your dragon? ${id}`,
      description: "Ever wonder?",
      body: "You have to believe",
      tags: ["dragons", "training"],
    });
    await editor.publish(/\/article\/did-you-train-your-dragon-/);

    // Article detail renders the just-saved content. These selectors
    // are the *article* surface, not the editor — belong to a future
    // article-detail POP (tracked as future Phase 2 work).
    await expect(page.locator(".banner h1")).toHaveText(
      `Did you train your dragon? ${id}`,
    );
    await expect(page.getByTestId("article-body")).toContainText(
      "You have to believe",
    );
    await expect(page.locator(".tag-list")).toContainText("dragons");
    await expect(page.locator(".tag-list")).toContainText("training");
  });

  test("Scenario 2: tag input accepts comma / enter separated pills with × remove", async ({
    page,
    context,
  }) => {
    const jake = `jake-${uniq()}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const editor = new EditorPage(page);
    await editor.gotoCreate(WEB_URL);

    await editor.addTag("one");
    await editor.expectTagVisible("one");
    await editor.expectTagInputEmpty();

    // Comma commits too (typed as part of the value).
    await editor.addTagByComma("two");
    await editor.expectTagVisible("two");
    await editor.expectTagInputEmpty();

    // × removes a pill.
    await editor.removeTag("one");
    await editor.expectTagAbsent("one");
    await editor.expectTagVisible("two");
  });

  test("Scenario 3: validation errors render at top of form and preserve other values", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const editor = new EditorPage(page);
    await editor.gotoCreate(WEB_URL);

    // Fill description/body/tag; leave title blank.
    await editor.fillForm({
      description: `desc ${id}`,
      body: `body ${id}`,
      tags: ["keeper"],
    });
    await editor.publishNoWait();

    await expect(page).toHaveURL(/\/editor$/);
    await editor.expectErrorContains("title can't be blank");
    // Preserved values.
    await editor.expectFormValues({
      description: `desc ${id}`,
      body: `body ${id}`,
    });
  });

  test("Scenario 4: edit existing own article re-posts and lands on the new slug", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    const slug = await createArticle(jakeApi, `How to train ${id}`, [
      "dragons",
    ]);

    const editor = new EditorPage(page);
    await editor.gotoEdit(WEB_URL, slug);

    // Prefilled.
    await editor.expectFormValues({
      title: `How to train ${id}`,
      description: "d",
    });

    // Rename.
    const newTitle = `How to train dragons — revised ${id}`;
    await editor.titleInput.fill(newTitle);
    await editor.publish(/\/article\/how-to-train-dragons-revised-/);
    await expect(page.locator(".banner h1")).toHaveText(newTitle);
  });

  test("Scenario 5: editing someone else's article redirects to the detail page", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    const jakeApi = await apiContext();
    const danApi = await apiContext();
    await registerUser(jakeApi, jake);
    const danSession = await registerUser(danApi, dan);
    await primeSession(context, danSession, dan);

    const slug = await createArticle(jakeApi, `Jake's secret ${id}`);

    const editor = new EditorPage(page);
    await editor.gotoEdit(WEB_URL, slug);
    await page.waitForURL(new RegExp(`/article/${slug}`));
    // No editor form on the destination page.
    await editor.expectAbsent();
  });

  test("Scenario 6: /editor requires auth, redirects to /login?redirect=/editor", async ({
    page,
  }) => {
    const res = await page.goto(`${WEB_URL}/editor`);
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)editor$/);
    expect(res?.status()).toBe(200);
  });
});

test("axe a11y gate on editor page (#87)", async ({ page, context }) => {
  const jake = `jake-${uniq()}`;
  const api = await apiContext();
  const session = await registerUser(api, jake);
  await primeSession(context, session, jake);
  await page.goto(`${WEB_URL}/editor`);
  await runAxe(page);
});
