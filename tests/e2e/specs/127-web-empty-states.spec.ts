import { expect, test } from "@playwright/test";
import { test as authedTest } from "../fixtures/authStorage";
import { ArticlesApi } from "../page-objects/articles";
import { runAxe } from "../axe-config";

// BDD coverage for issue #127 — first-run empty states on homepage,
// profile, and comment thread. Assertions target the shared
// EmptyState component (role="status") rather than exact copy, so
// future wording tweaks don't ripple through test churn. Copy is
// also sanity-checked at least once per scenario so we catch
// accidental removal.

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3101";

const WEB_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.WEB_URL ??
  "http://localhost:3100";

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("issue #127 — first-run empty states", () => {
  authedTest(
    "Scenario 1: empty your-feed nudges the authed viewer toward discovery",
    async ({ authedContext }) => {
      // The per-worker authed user starts with zero follows — their
      // /?feed=you is always empty until a spec makes them follow
      // someone. Perfect for this scenario.
      const page = await authedContext.newPage();
      await page.goto(`${WEB_URL}/?feed=you`);

      const empty = page.getByTestId("empty-state-your-feed");
      await expect(empty).toBeVisible();
      await expect(empty).toHaveAttribute("role", "status");
      await expect(empty).toContainText(/Your feed is empty/);
      // Action link to the global feed.
      await expect(empty.getByRole("link", { name: "Global feed" })).toHaveAttribute(
        "href",
        "/",
      );

      await runAxe(page);
    },
  );

  test("Scenario 2: empty favorited tab on profile nudges toward the global feed", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `e-p-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    // Jake exists but has favorited zero articles.

    await page.goto(`${WEB_URL}/profile/${jake}?tab=favorited`);

    const empty = page.getByTestId("empty-state-profile-favorited");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("role", "status");
    await expect(empty).toContainText(/No favorites yet/);
    await expect(empty.getByRole("link", { name: "Global feed" })).toHaveAttribute(
      "href",
      "/",
    );

    await runAxe(page);
  });

  test("Scenario 3: empty authored tab on profile shows calm copy, no redirect nudge", async ({
    page,
  }) => {
    const id = uniq();
    const jake = `e-a-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    // Jake exists but has published zero articles.

    await page.goto(`${WEB_URL}/profile/${jake}`);

    const empty = page.getByTestId("empty-state-profile-authored");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("role", "status");
    await expect(empty).toContainText(/No articles yet/);

    await runAxe(page);
  });

  test("Scenario 4: empty comment thread on an article — anon viewer sees a sign-in link", async ({
    page,
  }) => {
    // Seed an article with no comments.
    const id = uniq();
    const jake = `e-c-${id}`;
    const api = await ArticlesApi.newContext();
    await api.registerUser(jake);
    const slug = await api.createArticleReturnSlug({ title: `no-cmt-${id}` });

    await page.goto(`${WEB_URL}/article/${slug}`);

    const empty = page.getByTestId("empty-comments");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("role", "status");
    await expect(empty).toContainText(/No comments yet/);

    // Anon viewer: action is a sign-in link carrying a redirect back
    // to this article so post-login we land here, not the homepage.
    const signIn = empty.getByRole("link", { name: "Sign in" });
    const href = await signIn.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toContain("/login?redirect=");
    expect(decodeURIComponent(href ?? "")).toContain(`/article/${slug}`);

    await runAxe(page);
  });

  authedTest(
    "Scenario 5: empty comment thread — authed viewer sees compose-form nudge (no sign-in link)",
    async ({ authedContext }) => {
      // Seed an article with no comments (authored by a different
      // user so this test's authed fixture user didn't plant it).
      const id = uniq();
      const other = `e-o-${id}`;
      const api = await ArticlesApi.newContext();
      await api.registerUser(other);
      const slug = await api.createArticleReturnSlug({
        title: `no-cmt-auth-${id}`,
      });

      const page = await authedContext.newPage();
      await page.goto(`${WEB_URL}/article/${slug}`);

      const empty = page.getByTestId("empty-comments");
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(/Start the discussion/);
      // Authed viewers don't get the sign-in link — the compose form
      // on the page is the next step.
      await expect(
        empty.getByRole("link", { name: "Sign in" }),
      ).toHaveCount(0);
    },
  );
});
