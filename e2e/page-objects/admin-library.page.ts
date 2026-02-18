import { type Locator, type Page } from '@playwright/test';

export class AdminLibraryPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get libraryPathDisplay(): Locator {
    return this.page.getByText('Current directory:').locator('..').locator('p.font-mono');
  }

  get changeLibraryPathButton(): Locator {
    return this.page.getByRole('button', { name: /change directory/i });
  }

  get rescanLibraryButton(): Locator {
    return this.page.getByRole('button', { name: /restart watcher|rescan library/i });
  }

  get clearLibraryButton(): Locator {
    return this.page.getByRole('button', { name: /^clear library$/i }).first();
  }

  get clearConfirmDialog(): Locator {
    return this.page.getByRole('alertdialog').filter({ hasText: /clear library and re-index/i });
  }

  get resetAppButton(): Locator {
    return this.page.getByRole('button', { name: /^reset app$/i }).first();
  }

  get resetConfirmDialog(): Locator {
    return this.page.getByRole('alertdialog').filter({ hasText: /reset app and restart onboarding/i });
  }

  async clickClearLibrary(): Promise<void> {
    await this.clearLibraryButton.click();
    await this.clearConfirmDialog.getByRole('button', { name: /^clear library$/i }).click();
  }

  async clickResetApp(): Promise<void> {
    await this.resetAppButton.click();
    await this.resetConfirmDialog.getByRole('button', { name: /^reset app$/i }).click();
  }
}
