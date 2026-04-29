import { expect, type Locator, type Page } from "@playwright/test";

// Page object for the homepage ("/").
//
// #100 (Phase 2 of #35). Adapted from
// `mutoe/vue3-realworld-example-app @ dd34ba90`
// (`playwright/page-objects/*`, MIT). Vue → Next/React port: the
// homepage is a Server Component that renders the banner, feed
// tabs, article-preview list, tag sidebar, and paginator.
//
// The POP owns every selector for the home surface. Tests use
// semantic methods; FavoriteButton assertions on a preview card
// compose with the `FavoriteButton` component POP (#99) when
// available — if not merged yet, the caller uses the raw
// `previewCardFor(slug)` locator.

export type FeedMode = "global" | "you" | "tag";

export class HomePage {
  constructor(private readonly page: Page) {}

  // ─── Top-level regions ───────────────────────────────────────

  get banner(): Locator {
    return this.page.locator(".banner");
  }

  get feedToggle(): Locator {
    return this.page.locator(".feed-toggle");
  }

  get sidebar(): Locator {
    // The Suspense tag-cloud skeleton (#114/#120) also renders with
    // `class="sidebar skeleton-tag-cloud"` for layout parity, so a
    // bare `.sidebar` selector briefly matches 2 elements while the
    // RSC swap is mid-flight (strict-mode violation → #129). Exclude
    // the skeleton *itself* via CSS `:not([data-testid=...])` —
    // `filter({ hasNot })` only checks descendants, which doesn't
    // match here because the skeleton is the element carrying the
    // testid, not a parent of it. Callers then auto-wait on the
    // resolved sidebar instead of racing the swap.
    return this.page.locator(
      '.sidebar:not([data-testid="tag-cloud-skeleton"])',
    );
  }

  get paginator(): Locator {
    return this.page.locator("ul.pagination");
  }

  // ─── Feed tabs ───────────────────────────────────────────────

  get globalFeedTab(): Locator {
    return this.feedToggle.getByRole("link", { name: "Global Feed" });
  }

  get yourFeedTab(): Locator {
    return this.feedToggle.getByRole("link", { name: "Your Feed" });
  }

  get activeTab(): Locator {
    return this.feedToggle.locator(".nav-link.active");
  }

  // ─── Article previews ────────────────────────────────────────

  get previews(): Locator {
    return this.page.locator(".article-preview");
  }

  get previewHeadings(): Locator {
    return this.page.locator(".article-preview h1");
  }

  previewCardFor(slug: string): Locator {
    return this.page.locator(
      `.article-preview:has(a[href="/article/${slug}"])`,
    );
  }

  previewByTitle(title: string): Locator {
    return this.previews.filter({ hasText: title });
  }

  // ─── Sidebar tag pills ───────────────────────────────────────

  sidebarTagPill(tag: string): Locator {
    return this.sidebar.getByRole("link", { name: tag });
  }

  // ─── Navigation ──────────────────────────────────────────────

  async goto(baseUrl: string): Promise<Awaited<ReturnType<Page["goto"]>>> {
    return this.page.goto(`${baseUrl}/`);
  }

  async gotoFeed(
    baseUrl: string,
    mode: Exclude<FeedMode, "tag">,
  ): Promise<Awaited<ReturnType<Page["goto"]>>> {
    const path = mode === "you" ? "/?feed=you" : "/";
    return this.page.goto(`${baseUrl}${path}`);
  }

  async gotoTag(
    baseUrl: string,
    tag: string,
    page?: number,
  ): Promise<Awaited<ReturnType<Page["goto"]>>> {
    const params = new URLSearchParams();
    params.set("tag", tag);
    if (page !== undefined) params.set("page", String(page));
    return this.page.goto(`${baseUrl}/?${params.toString()}`);
  }

  async clickSidebarTag(tag: string): Promise<void> {
    await this.sidebarTagPill(tag).click();
    await this.page.waitForLoadState("networkidle");
  }

  // ─── Assertions ──────────────────────────────────────────────

  async expectBannerHeadline(): Promise<void> {
    await expect(this.banner).toContainText("conduit");
    await expect(this.banner).toContainText("A place to share your knowledge.");
  }

  async expectSidebarShowsPopularTags(): Promise<void> {
    await expect(this.sidebar).toContainText("Popular Tags");
  }

  async expectOnlyGlobalFeedVisible(): Promise<void> {
    await expect(this.globalFeedTab).toBeVisible();
    await expect(this.yourFeedTab).toHaveCount(0);
  }

  async expectYourFeedActive(): Promise<void> {
    await expect(this.yourFeedTab).toBeVisible();
    await expect(this.yourFeedTab).toHaveClass(/active/);
  }

  async expectActiveTabText(text: string | RegExp): Promise<void> {
    await expect(this.activeTab).toContainText(text);
  }

  async expectEmptyList(): Promise<void> {
    // Post-#127: empty states route through the shared EmptyState
    // component with context-aware copy. Each context lands on a
    // different first line (global-feed / your-feed / tag / profile),
    // so match the stable empty-state role + container rather than a
    // fixed copy string.
    await expect(this.previews.getByRole("status")).toBeVisible();
  }

  async allPreviewTitles(): Promise<string[]> {
    return this.previewHeadings.allTextContents();
  }

  // ─── Paginator helpers ───────────────────────────────────────

  async expectPageCount(count: number): Promise<void> {
    await expect(this.paginator.locator(".page-item")).toHaveCount(count);
  }

  async expectActivePage(page: string | number): Promise<void> {
    await expect(this.paginator.locator(".page-item.active")).toHaveText(
      String(page),
    );
  }
}
