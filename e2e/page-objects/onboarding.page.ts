import type { Page, Locator } from '@playwright/test';

export class OnboardingPage {
  readonly page: Page;
  readonly selectFolderButton: Locator;
  readonly getStartedButton: Locator;
  readonly libraryPathDisplay: Locator;

  constructor(page: Page) {
    this.page = page;
    this.selectFolderButton = page.getByRole('button', { name: /select folder|change folder/i });
    this.getStartedButton = page.getByRole('button', { name: /get started/i });
    this.libraryPathDisplay = page.locator('text=Library folder').locator('..').locator('p.font-mono');
  }

  async isAtOnboardingPage(): Promise<boolean> {
    await this.page.waitForLoadState('domcontentloaded');
    const url = this.page.url();
    const hasHeading = await this.page.getByRole('heading', { name: /alex/i }).isVisible().catch(() => false);
    const hasSelectButton = await this.selectFolderButton.isVisible().catch(() => false);
    return url.includes('/onboarding') || (hasHeading && hasSelectButton);
  }
}
