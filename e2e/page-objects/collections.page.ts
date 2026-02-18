import { type Locator, type Page } from '@playwright/test';

export class CollectionsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get createCollectionButton(): Locator {
    return this.page.getByRole('button', { name: /new collection|create collection/i });
  }

  get collectionCards(): Locator {
    return this.page.locator('a[href^="/collections/"]');
  }

  collectionCardByName(name: string): Locator {
    return this.collectionCards.filter({ hasText: name }).first();
  }

  get filterDropdown(): Locator {
    return this.page.locator('div').filter({
      has: this.page.getByRole('button', { name: /^All$/ }),
    }).first();
  }

  get createCollectionDialog(): Locator {
    return this.page.getByRole('dialog', { name: /new collection|create collection/i });
  }

  get collectionNameInput(): Locator {
    return this.createCollectionDialog.getByRole('textbox', { name: /^Name$/i });
  }

  get collectionDescriptionInput(): Locator {
    return this.createCollectionDialog.getByRole('textbox', { name: /^Description$/i });
  }

  get saveCollectionButton(): Locator {
    return this.createCollectionDialog.getByRole('button', { name: /create|save/i });
  }

  deleteCollectionButton(name: string): Locator {
    return this.collectionCardByName(name)
      .getByRole('button', { name: /^Delete$/ })
      .or(this.page.getByRole('button', { name: /^Delete$/ }));
  }

  shareCollectionButton(name: string): Locator {
    return this.collectionCardByName(name)
      .getByRole('button', { name: /share|stop sharing/i })
      .or(this.page.getByRole('button', { name: /share|stop sharing/i }));
  }

  get copyShareLinkButton(): Locator {
    return this.page.getByRole('button', { name: /copy link|copied/i });
  }

  async clickCollection(name: string): Promise<void> {
    await this.collectionCardByName(name).click();
    await this.page.waitForURL(/\/collections\/[^/]+$/, { timeout: 10000 });
  }

  async filterBy(filter: 'all' | 'private' | 'shared'): Promise<void> {
    const labels = {
      all: 'All',
      private: 'Private',
      shared: 'Shared',
    };

    await this.page.getByRole('button', { name: labels[filter], exact: true }).click();
  }
}
