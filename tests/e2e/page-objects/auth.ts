import { expect, type Locator, type Page } from "@playwright/test";

// Page object for the auth surface (/login, /register).
//
// #95 (Phase 2 of #35). Adapted from
// `mutoe/vue3-realworld-example-app @ dd34ba90`
// (`playwright/page-objects/*`, MIT). Vue → Next/React port: Server
// Actions replace the Vue form-submit plumbing, and the POP talks to
// the real Hono API on the compose stack rather than mocking.
//
// The POP owns every DOM selector for the auth pages. Specs import
// `AuthPage` and call semantic methods — spec bodies describe the
// user journey, not DOM traversal.

export type RegisterInput = {
  username: string;
  email: string;
  password: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export class AuthPage {
  constructor(private readonly page: Page) {}

  // ─── Locators ────────────────────────────────────────────────
  //
  // Exposed as readonly getters (not methods) so call sites read
  // like POP.nameInput rather than POP.getNameInput(). The inputs
  // are still async operations via Playwright's auto-waiting; the
  // getter just hands back a locator handle.

  get usernameInput(): Locator {
    return this.page.getByPlaceholder("Your Name");
  }

  get emailInput(): Locator {
    return this.page.getByPlaceholder("Email");
  }

  get passwordInput(): Locator {
    return this.page.getByPlaceholder("Password");
  }

  get signUpButton(): Locator {
    return this.page.getByRole("button", { name: "Sign up" });
  }

  get signInButton(): Locator {
    return this.page.getByRole("button", { name: "Sign in" });
  }

  get errorMessages(): Locator {
    return this.page.locator(".error-messages");
  }

  // ─── Navigation ──────────────────────────────────────────────

  async gotoRegister(): Promise<void> {
    await this.page.goto("/register");
  }

  async gotoLogin(): Promise<void> {
    await this.page.goto("/login");
  }

  // ─── Form fill helpers ───────────────────────────────────────

  async fillRegisterForm(input: RegisterInput): Promise<void> {
    await this.usernameInput.fill(input.username);
    await this.emailInput.fill(input.email);
    await this.passwordInput.fill(input.password);
  }

  async fillLoginForm(input: LoginInput): Promise<void> {
    await this.emailInput.fill(input.email);
    await this.passwordInput.fill(input.password);
  }

  // ─── End-to-end journeys ─────────────────────────────────────
  //
  // `submitRegister` and `submitLogin` both Promise.all the click +
  // waitForURL so the tests don't race the server-action redirect.
  // Callers pass the URL regex the action is expected to land on;
  // happy-path auth redirects to `/`, error paths stay on the auth
  // page and await their own UI assertions via `errorMessages`.

  async submitRegister(expectedUrl: string | RegExp = "**/"): Promise<void> {
    await Promise.all([
      this.page.waitForURL(expectedUrl),
      this.signUpButton.click(),
    ]);
  }

  async submitRegisterNoWait(): Promise<void> {
    await this.signUpButton.click();
  }

  async submitLogin(expectedUrl: string | RegExp = "**/"): Promise<void> {
    await Promise.all([
      this.page.waitForURL(expectedUrl),
      this.signInButton.click(),
    ]);
  }

  async submitLoginNoWait(): Promise<void> {
    await this.signInButton.click();
  }

  // Register a new user end-to-end on the happy path — fill, submit,
  // wait for the redirect to `/`. Used by every spec that needs a
  // freshly-registered user visible to the next assertions.
  async registerNewUser(input: RegisterInput): Promise<void> {
    await this.gotoRegister();
    await this.fillRegisterForm(input);
    await this.submitRegister();
  }

  // ─── Navbar / cookie assertions ──────────────────────────────
  //
  // The navbar exposes the authed username as `@<username>` — the
  // auth flow is "done" when that link appears. Specs use this as
  // the canonical "am I logged in" signal.

  async expectNavbarShowsUser(username: string): Promise<void> {
    await expect(
      this.page
        .locator("nav.navbar")
        .getByRole("link", { name: new RegExp(`@${username}`) }),
    ).toBeVisible();
  }

  async expectErrorContains(message: string): Promise<void> {
    await expect(this.errorMessages).toContainText(message);
  }
}
