import { expect, type Locator, type Page } from "@playwright/test";

// Page object for the /settings surface.
//
// #102 (Phase 2 of #35). Adapted from
// `mutoe/vue3-realworld-example-app @ dd34ba90`
// (`playwright/page-objects/*`, MIT). Vue → Next/React port: the form
// is a Next Server Action, not a Vue submit handler; the POP talks to
// the real Hono API via cookie-primed requests.

export type UpdateInput = {
  image?: string;
  username?: string;
  bio?: string;
  email?: string;
  newPassword?: string;
};

export class SettingsPage {
  constructor(private readonly page: Page) {}

  // ─── Locators ────────────────────────────────────────────────

  get form(): Locator {
    return this.page.getByRole("form", { name: "Settings" });
  }

  get imageInput(): Locator {
    return this.form.getByPlaceholder("URL of profile picture");
  }

  get usernameInput(): Locator {
    return this.form.getByPlaceholder("Your Name");
  }

  get bioInput(): Locator {
    return this.form.getByPlaceholder("Short bio about you");
  }

  get emailInput(): Locator {
    return this.form.getByPlaceholder("Email");
  }

  get newPasswordInput(): Locator {
    return this.form.getByPlaceholder("New Password");
  }

  get updateButton(): Locator {
    return this.form.getByRole("button", { name: "Update Settings" });
  }

  get logoutButton(): Locator {
    return this.page.getByRole("button", { name: /Or click here to logout/ });
  }

  get errorMessages(): Locator {
    return this.page.locator(".error-messages");
  }

  // ─── Navigation ──────────────────────────────────────────────

  async goto(baseUrl: string): Promise<void> {
    await this.page.goto(`${baseUrl}/settings`);
  }

  // ─── Form fill + submit ──────────────────────────────────────

  async fillForm(input: UpdateInput): Promise<void> {
    if (input.image !== undefined) await this.imageInput.fill(input.image);
    if (input.username !== undefined) await this.usernameInput.fill(input.username);
    if (input.bio !== undefined) await this.bioInput.fill(input.bio);
    if (input.email !== undefined) await this.emailInput.fill(input.email);
    if (input.newPassword !== undefined) {
      await this.newPasswordInput.fill(input.newPassword);
    }
  }

  async submitUpdate(): Promise<void> {
    await this.updateButton.click();
  }

  async submitUpdateAndWait(expectedUrl: string | RegExp): Promise<void> {
    await Promise.all([
      this.page.waitForURL(expectedUrl),
      this.updateButton.click(),
    ]);
  }

  async logout(): Promise<void> {
    await this.logoutButton.click();
  }

  // ─── Assertions ──────────────────────────────────────────────

  async expectFormVisible(): Promise<void> {
    await expect(this.form).toBeVisible();
  }

  async expectFormValues(expected: UpdateInput): Promise<void> {
    if (expected.image !== undefined) {
      await expect(this.imageInput).toHaveValue(expected.image);
    }
    if (expected.username !== undefined) {
      await expect(this.usernameInput).toHaveValue(expected.username);
    }
    if (expected.bio !== undefined) {
      await expect(this.bioInput).toHaveValue(expected.bio);
    }
    if (expected.email !== undefined) {
      await expect(this.emailInput).toHaveValue(expected.email);
    }
    if (expected.newPassword !== undefined) {
      await expect(this.newPasswordInput).toHaveValue(expected.newPassword);
    }
  }

  async expectErrorContains(message: string): Promise<void> {
    await expect(this.errorMessages).toContainText(message);
  }
}
