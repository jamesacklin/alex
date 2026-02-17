import { test, expect } from '../fixtures/auth.fixture';
import { LibraryPage } from '../page-objects/library.page';

test.describe('Library Page', () => {
  test('displays books after seeding (US-005)', async ({ authenticatedPage }) => {
    const libraryPage = new LibraryPage(authenticatedPage);

    // Navigate to library
    await libraryPage.goto();

    // Wait for books to load
    await libraryPage.waitForBooksToLoad();

    // Verify at least 3 books are displayed (from seed data)
    const bookCount = await libraryPage.getBookCount();
    expect(bookCount).toBeGreaterThanOrEqual(3);

    // Verify each book card has a title and cover image
    const bookCards = await libraryPage.bookCards.all();
    for (const card of bookCards) {
      // Check for title (h3 element)
      const titleElement = card.locator('h3');
      await expect(titleElement).toBeVisible();
      const titleText = await titleElement.textContent();
      expect(titleText).toBeTruthy();

      // Check for cover image
      const coverImage = card.locator('img');
      await expect(coverImage).toBeVisible();
    }
  });
});
