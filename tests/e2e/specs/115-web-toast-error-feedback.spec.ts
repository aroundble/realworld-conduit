import {
  expect,
  request,
  test,
  type BrowserContext,
} from "@playwright/test";
import { runAxe } from "../axe-config";
import { FavoritesApi } from "../page-objects/favorite";

// BDD coverage for issue #115: toast error feedback for failing
// server actions.
//
// Failure-induction approach: rather than trying to mock the
// Next-internal apiFetch (server actions run inside the web
// container and call the API over the internal docker network, so
// Playwright's `page.route` can't intercept them), we induce a real
// failure by deleting the row the action operates on after the page
// renders. The same pattern spec 56 Scenario 3 uses for the
// optimistic-revert test.

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

// Toast locator shared across scenarios. Sonner renders each toast
// as an `<li data-sonner-toast>` inside an `<ol>` region (with
// announcements wrapped in a sibling aria-live section). Matching on
// the data-sonner-toast attribute + filtering by text is the
// documented stable selector surface.
const toastLocator = (
  page: import("@playwright/test").Page,
  hasText: RegExp,
) => page.locator("[data-sonner-toast]").filter({ hasText });

test.describe("issue #115 — toast error feedback for failing server actions", () => {
  test("Scenario 1: favorite failure surfaces a toast", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const jakeApi = await FavoritesApi.newContext();
    const danApi = await FavoritesApi.newContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await jakeApi.registerUser(jake);
    const danSession = await danApi.registerUser(dan);
    const slug = await jakeApi.createArticle(`Toast Fav ${id}`);
    await primeSession(context, danSession, dan);

    await page.goto(`${WEB_URL}/`);
    const card = page.locator(
      `.article-preview:has(a[href="/article/${slug}"])`,
    );
    const favBtn = card.getByTestId("favorite-button");
    await expect(favBtn).toBeVisible();

    // Induce a 404 by deleting the article before the click. The
    // server action's apiFetch call will throw on non-2xx, the
    // client component's catch block fires toast.error. Same shape
    // as spec 56 Scenario 3.
    await jakeApi.deleteArticle(slug);

    await favBtn.click();

    const toast = toastLocator(page, /Couldn't favorite/);
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText("please try again");

    // Optimistic flip reverted.
    await expect(favBtn).toHaveAttribute("aria-pressed", "false");
    await expect(favBtn).toContainText("0");
  });

  test("Scenario 2: follow failure surfaces a toast", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const api = await apiContext();
    const danApi = await apiContext();
    const jake = `jake-${id}`;
    const dan = `dan-${id}`;
    await registerUser(api, jake);
    const danSession = await registerUser(danApi, dan);

    // Seed an article so dan has something to click Follow from on
    // jake's profile page.
    await api.post("/api/articles", {
      data: { article: { title: `By jake ${id}`, description: "d", body: "b" } },
    });

    await primeSession(context, danSession, dan);

    // Intercept the follow endpoint in the API to return 500 — this
    // endpoint is called FROM the Next container, but dan's action
    // also goes through apiFetch which will throw non-2xx. We can't
    // route that directly, but we CAN delete jake so the follow 404s.
    await page.goto(`${WEB_URL}/profile/${jake}`);
    const followBtn = page.getByRole("button", { name: `Follow ${jake}` });
    await expect(followBtn).toBeVisible();

    // Delete jake via admin-less path: delete their articles + rely
    // on /api/profiles/<dead-user>/follow returning 404. Actually
    // easier: there's no user delete endpoint. Force the failure by
    // sending the follow before the page renders a valid target.
    // Alternative: intercept the Next server-action RPC POST. Try
    // that with a route handler matched on `next-action` header.
    await context.route(
      (url) => url.pathname === `/profile/${encodeURIComponent(jake)}`,
      async (route) => {
        const headers = route.request().headers();
        if (headers["next-action"]) {
          await route.fulfill({
            status: 500,
            body: "injected failure for #115",
          });
          return;
        }
        await route.continue();
      },
    );

    await followBtn.click();

    const toast = toastLocator(page, /Couldn't follow/);
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText(`@${jake}`);
  });

  test("Scenario 3: delete-article failure surfaces a toast and keeps the page", async ({
    page,
    context,
  }) => {
    const id = uniq();
    const api = await apiContext();
    const jake = `jake-${id}`;
    const session = await registerUser(api, jake);
    await primeSession(context, session, jake);

    const created = await api.post("/api/articles", {
      data: {
        article: { title: `To delete ${id}`, description: "d", body: "b" },
      },
    });
    const slug = ((await created.json()) as { article: { slug: string } })
      .article.slug;

    // Auto-accept the confirm() dialog.
    page.on("dialog", (d) => d.accept());

    // Intercept the delete-article server-action RPC to return 500.
    // Context-level route so it applies to the action's RPC even
    // after the page.goto navigation invokes it.
    await context.route(
      (url) => url.pathname === `/article/${encodeURIComponent(slug)}`,
      async (route) => {
        const headers = route.request().headers();
        if (headers["next-action"]) {
          await route.fulfill({
            status: 500,
            body: "injected failure for #115",
          });
          return;
        }
        await route.continue();
      },
    );

    await page.goto(`${WEB_URL}/article/${slug}`);
    // The article page renders the meta block twice (banner + below
    // body), each with its own DeleteArticleButton. Click the first
    // one — same surface area.
    const deleteBtn = page.getByRole("button", { name: /Delete Article/ }).first();
    await deleteBtn.click();

    const toast = toastLocator(page, /Couldn't delete/);
    await expect(toast).toBeVisible({ timeout: 3000 });

    // Stayed on the article page — no redirect.
    await expect(page).toHaveURL(new RegExp(`/article/${slug}`));
  });

  test("Scenario 4: existing inline form errors (422) do not surface as toasts", async ({
    page,
  }) => {
    // Register form with invalid email triggers conform-to's inline
    // error-messages list — no toast.
    await page.goto(`${WEB_URL}/register`);
    await page.getByPlaceholder("Your Name").fill("jake");
    await page.getByPlaceholder("Email").fill("notAnEmail");
    await page.getByPlaceholder("Email").press("Tab");
    await page.getByRole("button", { name: "Sign up" }).click();

    // Stayed on /register with inline errors.
    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator(".error-messages")).toContainText(
      "email must be a valid email",
    );

    // No sonner toast. The Toaster's <ol> may be in the DOM but has
    // zero `[data-sonner-toast]` children when nothing is queued.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });
});

test("axe a11y gate on toast region (#87)", async ({ page, context }) => {
  const id = uniq();
  const jakeApi = await FavoritesApi.newContext();
  const danApi = await FavoritesApi.newContext();
  const jake = `jake-${id}`;
  const dan = `dan-${id}`;
  await jakeApi.registerUser(jake);
  const danSession = await danApi.registerUser(dan);
  const slug = await jakeApi.createArticle(`Toast axe ${id}`);
  await primeSession(context, danSession, dan);

  await page.goto(`${WEB_URL}/`);
  const favBtn = page
    .locator(`.article-preview:has(a[href="/article/${slug}"])`)
    .getByTestId("favorite-button");
  await expect(favBtn).toBeVisible();

  // Delete the article to force the favorite action to fail.
  await jakeApi.deleteArticle(slug);
  await favBtn.click();

  await expect(toastLocator(page, /Couldn't favorite/)).toBeVisible({
    timeout: 3000,
  });
  await runAxe(page);
});
