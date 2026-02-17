import { Page, Locator } from '@playwright/test';

export class LibraryPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Selectors
  get bookCards(): Locator {
    return this.page.locator('a[href^="/read/"]');
  }

  get loadMoreButton(): Locator {
    return this.page.locator('button:has-text("Load More Books")');
  }

  bookCardByTitle(title: string): Locator {
    return this.page.locator('a[href^="/read/"]', { has: this.page.locator(`h3:has-text("${title}")`) });
  }

  // Filter buttons
  typeFilterButton(type: 'all' | 'pdf' | 'epub'): Locator {
    const labels = { all: 'All Types', pdf: 'PDF', epub: 'ePub' };
    return this.page.locator(`button:has-text("${labels[type]}")`);
  }

  statusFilterButton(status: 'all' | 'not_started' | 'reading' | 'completed'): Locator {
    const labels = {
      all: 'All',
      not_started: 'Not Started',
      reading: 'Reading',
      completed: 'Completed'
    };
    return this.page.locator(`button:has-text("${labels[status]}")`).first();
  }

  sortButton(sort: 'added' | 'read' | 'title' | 'author'): Locator {
    const labels = {
      added: 'Recent',
      read: 'Last Read',
      title: 'Title',
      author: 'Author'
    };
    return this.page.locator(`button:has-text("${labels[sort]}")`);
  }

  get emptyStateMessage(): Locator {
    return this.page.locator('text=No books found');
  }

  get skeletonLoaders(): Locator {
    return this.page.locator('.animate-pulse');
  }

  // Methods
  async goto(): Promise<void> {
    // Check if we're already on the library page (Electron starts here)
    const currentUrl = this.page.url();
    if (!currentUrl.includes('/library')) {
      await this.page.goto('/library');
    }
    await this.page.waitForLoadState('domcontentloaded');
  }

  async getBookCount(): Promise<number> {
    return await this.bookCards.count();
  }

  async filterByType(type: 'all' | 'pdf' | 'epub'): Promise<void> {
    await this.typeFilterButton(type).click();
    // Wait for skeletons to disappear (filter applied)
    await this.waitForBooksToLoad();
  }

  async filterByStatus(status: 'all' | 'not_started' | 'reading' | 'completed'): Promise<void> {
    await this.statusFilterButton(status).click();
    // Wait for skeletons to disappear (filter applied)
    await this.waitForBooksToLoad();
  }

  async sortBy(sort: 'added' | 'read' | 'title' | 'author'): Promise<void> {
    await this.sortButton(sort).click();
    // Wait for skeletons to disappear (sort applied)
    await this.waitForBooksToLoad();
  }

  async clickBook(title: string): Promise<void> {
    await this.bookCardByTitle(title).click();
  }

  async clickLoadMore(): Promise<void> {
    const currentCount = await this.getBookCount();
    await this.loadMoreButton.click();
    // Wait for new books to appear
    await this.page.waitForFunction((count) => {
      const cards = document.querySelectorAll('a[href^="/read/"]');
      return cards.length > count;
    }, currentCount, { timeout: 10000 });
  }

  async getLoadingState(): Promise<boolean> {
    const skeletonCount = await this.skeletonLoaders.count();
    return skeletonCount > 0;
  }

  async getBookTitles(): Promise<string[]> {
    const cards = await this.bookCards.all();
    const titles: string[] = [];
    for (const card of cards) {
      const titleElement = card.locator('h3');
      const title = await titleElement.textContent();
      if (title) {
        titles.push(title);
      }
    }
    return titles;
  }

  async waitForBooksToLoad(): Promise<void> {
    // Wait for either book cards or empty state to appear, with longer timeout for Electron
    await this.page.waitForFunction(
      () => {
        const bookCards = document.querySelectorAll('a[href^="/read/"]');
        const emptyStateText = document.body.textContent || '';
        const hasEmptyState = emptyStateText.includes('No books found');
        const skeletons = document.querySelectorAll('.animate-pulse');

        // Books loaded or empty state shown, and no skeletons visible
        return (bookCards.length > 0 || hasEmptyState) && skeletons.length === 0;
      },
      { timeout: 20000 }
    );

    // Give a small delay for any final rendering
    await this.page.waitForTimeout(300);
  }
}
