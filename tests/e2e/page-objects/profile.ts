import { expect, type Locator, type Page } from "@playwright/test";

// Page object for /profile/:username.
//
// #101 (Phase 2 of #35). Adapted from
// `mutoe/vue3-realworld-example-app @ dd34ba90`
// (`playwright/page-objects/*`, MIT).

export type ProfileTab = "my" | "favorited";

export class ProfilePage {
  constructor(private readonly page: Page) {}

  // ─── Locators ────────────────────────────────────────────────

  get banner(): Locator {
    return this.page.locator(".user-info");
  }

  get usernameHeading(): Locator {
    return this.page.locator(".user-info h4");
  }

  get myArticlesTab(): Locator {
    return this.page.getByRole("link", { name: "My Articles" });
  }

  get favoritedTab(): Locator {
    return this.page.getByRole("link", { name: "Favorited Articles" });
  }

  get editProfileLink(): Locator {
    return this.page.getByRole("link", { name: /Edit Profile Settings/ });
  }

  get allFollowButtons(): Locator {
    return this.page.getByRole("button", { name: /^Follow|^Unfollow/ });
  }

  followButtonFor(username: string): Locator {
    return this.page.getByRole("button", { name: `Follow ${username}` });
  }

  unfollowButtonFor(username: string): Locator {
    return this.page.getByRole("button", { name: `Unfollow ${username}` });
  }

  get articlePreviews(): Locator {
    return this.page.locator(".article-preview");
  }

  get articlePreviewHeadings(): Locator {
    return this.page.locator(".article-preview h1");
  }

  // ─── Navigation ──────────────────────────────────────────────

  async goto(baseUrl: string, username: string): Promise<void> {
    await this.page.goto(`${baseUrl}/profile/${username}`);
  }

  async gotoFavoritedTab(baseUrl: string, username: string): Promise<void> {
    await this.page.goto(`${baseUrl}/profile/${username}?tab=favorited`);
  }

  // ─── Interactions ────────────────────────────────────────────

  async clickFavoritedTab(): Promise<void> {
    await this.favoritedTab.click();
    await this.page.waitForURL(/\/profile\/.+\?tab=favorited/);
  }

  async follow(username: string): Promise<void> {
    await this.followButtonFor(username).click();
    await expect(this.unfollowButtonFor(username)).toBeVisible();
  }

  // ─── Assertions ──────────────────────────────────────────────

  async expectUsername(username: string): Promise<void> {
    await expect(this.usernameHeading).toHaveText(username);
  }

  async expectTabActive(tab: ProfileTab): Promise<void> {
    const activeTab = tab === "my" ? this.myArticlesTab : this.favoritedTab;
    const inactiveTab = tab === "my" ? this.favoritedTab : this.myArticlesTab;
    await expect(activeTab).toHaveClass(/active/);
    await expect(inactiveTab).not.toHaveClass(/active/);
  }

  async expectEditProfileLink(): Promise<void> {
    await expect(this.editProfileLink).toHaveAttribute("href", "/settings");
  }

  async expectNoFollowButton(): Promise<void> {
    await expect(this.allFollowButtons).toHaveCount(0);
  }

  async expectFollowing(username: string): Promise<void> {
    await expect(this.unfollowButtonFor(username)).toBeVisible();
  }

  async expectFollowButtonVisible(username: string): Promise<void> {
    await expect(this.followButtonFor(username)).toBeVisible();
  }

  async expectEmptyList(): Promise<void> {
    // Post-#127: empty states are rendered by the shared EmptyState
    // component with role="status". Copy varies by tab
    // (profile-authored vs profile-favorited); match the stable
    // container rather than a specific string.
    await expect(this.articlePreviews.getByRole("status")).toBeVisible();
  }

  // Returns article-preview headings, optionally filtered to ones
  // whose title ends with a given suffix (`` ${id}``) so parallel
  // seeds don't leak into assertions.
  async titlesEndingWith(suffix: string): Promise<string[]> {
    const all = await this.articlePreviewHeadings.allTextContents();
    return all.filter((t) => t.endsWith(suffix));
  }
}
