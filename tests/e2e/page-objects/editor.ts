import { expect, type Locator, type Page } from "@playwright/test";

// Page object for the /editor + /editor/[slug] surface.
//
// #98 (Phase 2 of #35). Adapted from
// `mutoe/vue3-realworld-example-app @ dd34ba90`
// (`playwright/page-objects/*`, MIT). The form is a Next Server
// Action wired via @conform-to/zod; the POP talks to the real
// rendered form.

export type EditorInput = {
  title?: string;
  description?: string;
  body?: string;
  tags?: string[];
};

export class EditorPage {
  constructor(private readonly page: Page) {}

  // ─── Locators ────────────────────────────────────────────────

  get form(): Locator {
    return this.page.getByRole("form", { name: "Editor" });
  }

  get titleInput(): Locator {
    return this.form.getByPlaceholder("Article Title");
  }

  get descriptionInput(): Locator {
    return this.form.getByPlaceholder("What's this article about?");
  }

  get bodyInput(): Locator {
    return this.form.getByPlaceholder("Write your article (in markdown)");
  }

  get tagInput(): Locator {
    return this.form.getByLabel("Enter tags");
  }

  get publishButton(): Locator {
    return this.form.getByRole("button", { name: "Publish Article" });
  }

  get errorMessages(): Locator {
    return this.form.locator(".error-messages");
  }

  tagPill(tag: string): Locator {
    return this.form.getByTestId(`tag-pill-${tag}`);
  }

  removeTagButton(tag: string): Locator {
    return this.form.getByRole("button", { name: `Remove tag ${tag}` });
  }

  // ─── Navigation ──────────────────────────────────────────────

  async gotoCreate(baseUrl: string): Promise<void> {
    await this.page.goto(`${baseUrl}/editor`);
  }

  async gotoEdit(baseUrl: string, slug: string): Promise<void> {
    await this.page.goto(`${baseUrl}/editor/${slug}`);
  }

  // ─── Form fill helpers ───────────────────────────────────────

  async fillForm(input: EditorInput): Promise<void> {
    if (input.title !== undefined) await this.titleInput.fill(input.title);
    if (input.description !== undefined) {
      await this.descriptionInput.fill(input.description);
    }
    if (input.body !== undefined) await this.bodyInput.fill(input.body);
    for (const tag of input.tags ?? []) {
      await this.addTag(tag);
    }
  }

  // Commit a tag via Enter (matching the UI's tag-input contract).
  async addTag(tag: string): Promise<void> {
    await this.tagInput.fill(tag);
    await this.tagInput.press("Enter");
  }

  // Commit a tag via typing a trailing comma.
  async addTagByComma(tag: string): Promise<void> {
    await this.tagInput.fill(`${tag},`);
  }

  async removeTag(tag: string): Promise<void> {
    await this.removeTagButton(tag).click();
  }

  // ─── Submission ──────────────────────────────────────────────
  //
  // `publish` handles both flavours: the happy path navigates to
  // `/article/<slug>` (callers pass the expected URL regex); error
  // paths stay on /editor (publishNoWait).

  async publish(expectedUrl: string | RegExp): Promise<void> {
    await Promise.all([
      this.page.waitForURL(expectedUrl),
      this.publishButton.click(),
    ]);
  }

  async publishNoWait(): Promise<void> {
    await this.publishButton.click();
  }

  // ─── Assertions ──────────────────────────────────────────────

  async expectFormValues(expected: EditorInput): Promise<void> {
    if (expected.title !== undefined) {
      await expect(this.titleInput).toHaveValue(expected.title);
    }
    if (expected.description !== undefined) {
      await expect(this.descriptionInput).toHaveValue(expected.description);
    }
    if (expected.body !== undefined) {
      await expect(this.bodyInput).toHaveValue(expected.body);
    }
  }

  async expectTagVisible(tag: string): Promise<void> {
    await expect(this.tagPill(tag)).toBeVisible();
  }

  async expectTagAbsent(tag: string): Promise<void> {
    await expect(this.tagPill(tag)).toHaveCount(0);
  }

  async expectTagInputEmpty(): Promise<void> {
    await expect(this.tagInput).toHaveValue("");
  }

  async expectErrorContains(message: string): Promise<void> {
    await expect(this.errorMessages).toContainText(message);
  }

  async expectAbsent(): Promise<void> {
    await expect(this.form).toHaveCount(0);
  }
}
