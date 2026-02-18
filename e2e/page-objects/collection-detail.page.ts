import { type Locator, type Page } from '@playwright/test';

export class CollectionDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get collectionTitle(): Locator {
    return this.page.getByRole('heading', { level: 1 }).first();
  }

  get collectionDescription(): Locator {
    return this.page.locator('h1 + p').first();
  }

  get addBooksButton(): Locator {
    return this.page.getByRole('button', { name: /add books|add to collection/i });
  }

  get bookCards(): Locator {
    return this.page.locator('a[href^="/read/"]');
  }

  removeBookButton(bookTitle: string): Locator {
    return this.bookCards
      .filter({ has: this.page.locator('h3', { hasText: bookTitle }) })
      .getByRole('button', { name: /remove from collection/i })
      .first();
  }

  get addBooksDialog(): Locator {
    return this.page.getByRole('dialog', { name: /add books|add to collection/i });
  }

  get availableBooks(): Locator {
    return this.addBooksDialog.locator('[role="checkbox"][aria-checked="false"]');
  }

  async addBookToCollection(bookTitle: string): Promise<void> {
    const detailUrl = this.page.url();
    const collectionName = (await this.collectionTitle.textContent())?.trim();
    if (!collectionName) {
      throw new Error('Collection title not found');
    }

    const origin = new URL(this.page.url()).origin;
    await this.page.goto(`${origin}/library`);

    const targetBookCard = this.page.locator('a[href^="/read/"]').filter({
      has: this.page.locator('h3', { hasText: bookTitle }),
    }).first();

    await targetBookCard.getByRole('button', { name: /add to collection/i }).click();
    await this.addBooksDialog.getByRole('checkbox', { name: collectionName }).click();
    await this.addBooksDialog.getByRole('button', { name: /^Done$/ }).click();

    await this.page.goto(detailUrl);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async removeBookFromCollection(bookTitle: string): Promise<void> {
    await this.removeBookButton(bookTitle).click();
  }

  async getBookCount(): Promise<number> {
    return this.bookCards.count();
  }
}
