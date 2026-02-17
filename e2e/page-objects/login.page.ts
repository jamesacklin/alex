import type { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByRole('textbox', { name: /email/i });
    this.passwordInput = page.getByLabel(/password/i);
    this.signInButton = page.getByRole('button', { name: /sign in/i });
    this.errorMessage = page.getByText(/invalid email or password/i);
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }

  async isAtLoginPage(): Promise<boolean> {
    await this.page.waitForLoadState('domcontentloaded');
    const url = this.page.url();
    const title = await this.page.title();
    return url.includes('/login') || title.toLowerCase().includes('alex');
  }
}
