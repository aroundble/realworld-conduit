import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";

// BDD coverage for issue #19: editor page (create + edit).

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

    await page.goto(`${WEB_URL}/editor`);
    const form = page.getByRole("form", { name: "Editor" });
    await form
      .getByPlaceholder("Article Title")
      .fill(`Did you train your dragon? ${id}`);
    await form
      .getByPlaceholder("What's this article about?")
      .fill("Ever wonder?");
    await form
      .getByPlaceholder("Write your article (in markdown)")
      .fill("You have to believe");
    // Tag input accepts two comma-delimited tags.
    const tagInput = form.getByLabel("Enter tags");
    await tagInput.fill("dragons");
    await tagInput.press("Enter");
    await tagInput.fill("training");
    await tagInput.press("Enter");

    await Promise.all([
      page.waitForURL(/\/article\/did-you-train-your-dragon-/),
      form.getByRole("button", { name: "Publish Article" }).click(),
    ]);

    // Article detail renders the just-saved content.
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
    const id = uniq();
    const jake = `jake-${id}`;
    const jakeApi = await apiContext();
    const session = await registerUser(jakeApi, jake);
    await primeSession(context, session, jake);

    await page.goto(`${WEB_URL}/editor`);
    const form = page.getByRole("form", { name: "Editor" });
    const tagInput = form.getByLabel("Enter tags");

    await tagInput.fill("one");
    await tagInput.press("Enter");
    await expect(form.getByTestId("tag-pill-one")).toBeVisible();
    await expect(tagInput).toHaveValue("");

    // Comma commits too (typed as part of the value).
    await tagInput.fill("two,");
    await expect(form.getByTestId("tag-pill-two")).toBeVisible();
    await expect(tagInput).toHaveValue("");

    // × removes a pill.
    await form.getByRole("button", { name: "Remove tag one" }).click();
    await expect(form.getByTestId("tag-pill-one")).toHaveCount(0);
    await expect(form.getByTestId("tag-pill-two")).toBeVisible();
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

    await page.goto(`${WEB_URL}/editor`);
    const form = page.getByRole("form", { name: "Editor" });

    // Fill description/body/tag; leave title blank.
    await form.getByPlaceholder("What's this article about?").fill(`desc ${id}`);
    await form
      .getByPlaceholder("Write your article (in markdown)")
      .fill(`body ${id}`);
    const tagInput = form.getByLabel("Enter tags");
    await tagInput.fill("keeper");
    await tagInput.press("Enter");

    await form.getByRole("button", { name: "Publish Article" }).click();

    await expect(page).toHaveURL(/\/editor$/);
    await expect(form.locator(".error-messages")).toContainText(
      "title can't be blank",
    );
    // Preserved values.
    await expect(
      form.getByPlaceholder("What's this article about?"),
    ).toHaveValue(`desc ${id}`);
    await expect(
      form.getByPlaceholder("Write your article (in markdown)"),
    ).toHaveValue(`body ${id}`);
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

    await page.goto(`${WEB_URL}/editor/${slug}`);
    const form = page.getByRole("form", { name: "Editor" });

    // Prefilled.
    await expect(form.getByPlaceholder("Article Title")).toHaveValue(
      `How to train ${id}`,
    );
    await expect(form.getByPlaceholder("What's this article about?")).toHaveValue("d");

    // Rename.
    const newTitle = `How to train dragons — revised ${id}`;
    await form.getByPlaceholder("Article Title").fill(newTitle);
    await Promise.all([
      page.waitForURL(/\/article\/how-to-train-dragons-revised-/),
      form.getByRole("button", { name: "Publish Article" }).click(),
    ]);
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

    await page.goto(`${WEB_URL}/editor/${slug}`);
    await page.waitForURL(new RegExp(`/article/${slug}`));
    // No editor form on the destination page.
    await expect(
      page.getByRole("form", { name: "Editor" }),
    ).toHaveCount(0);
  });

  test("Scenario 6: /editor requires auth, redirects to /login?redirect=/editor", async ({
    page,
  }) => {
    const res = await page.goto(`${WEB_URL}/editor`);
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)editor$/);
    expect(res?.status()).toBe(200);
  });
});
