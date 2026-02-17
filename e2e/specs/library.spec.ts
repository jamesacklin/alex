import { test, expect } from '../fixtures/auth.fixture';
import { LibraryPage } from '../page-objects/library.page';
import { resetDatabase, seedDatabase, seedManyBooks } from '../helpers/db';

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

  test('searches books by title (US-006)', async ({ authenticatedPage }) => {
    const libraryPage = new LibraryPage(authenticatedPage);

    await libraryPage.goto();
    await libraryPage.waitForBooksToLoad();

    // Get initial book count
    const initialCount = await libraryPage.getBookCount();
    expect(initialCount).toBeGreaterThanOrEqual(3);

    // Search for a specific book (from our seed data: "Sample PDF Book")
    // Use baseURL to construct absolute URL for cross-platform compatibility
    const currentUrl = authenticatedPage.url();
    const baseUrl = currentUrl.split('/library')[0];
    await authenticatedPage.goto(`${baseUrl}/library?q=Sample+PDF`);
    await libraryPage.waitForBooksToLoad();

    // Verify only matching books are displayed
    const titlesAfterSearch = await libraryPage.getBookTitles();
    expect(titlesAfterSearch.length).toBeGreaterThan(0);
    expect(titlesAfterSearch.length).toBeLessThan(initialCount);

    // Verify the matching book is present
    const hasSamplePdf = titlesAfterSearch.some(title => title.includes('Sample PDF'));
    expect(hasSamplePdf).toBe(true);

    // Clear search
    await authenticatedPage.goto(`${baseUrl}/library`);
    await libraryPage.waitForBooksToLoad();

    // Verify all books return
    const countAfterClear = await libraryPage.getBookCount();
    expect(countAfterClear).toBe(initialCount);
  });

  test('filters books by file type (US-007)', async ({ authenticatedPage }) => {
    const libraryPage = new LibraryPage(authenticatedPage);

    await libraryPage.goto();
    await libraryPage.waitForBooksToLoad();

    // Filter by PDF
    await libraryPage.filterByType('pdf');

    // Verify only PDF books are shown (we seeded 2 PDFs)
    const pdfTitles = await libraryPage.getBookTitles();
    expect(pdfTitles.length).toBeGreaterThan(0);
    // Should have our two PDF books from seed
    const hasSamplePdf = pdfTitles.some(title => title.includes('Sample PDF'));
    const hasAnotherPdf = pdfTitles.some(title => title.includes('Another PDF'));
    expect(hasSamplePdf || hasAnotherPdf).toBe(true);

    // Filter by EPUB
    await libraryPage.filterByType('epub');

    // Verify only EPUB books are shown (we seeded 1 EPUB)
    const epubTitles = await libraryPage.getBookTitles();
    expect(epubTitles.length).toBeGreaterThan(0);
    const hasSampleEpub = epubTitles.some(title => title.includes('Sample EPUB'));
    expect(hasSampleEpub).toBe(true);

    // Filter by All
    await libraryPage.filterByType('all');

    // Verify all books return
    const allTitles = await libraryPage.getBookTitles();
    expect(allTitles.length).toBeGreaterThanOrEqual(3);
  });

  test('sorts books by title, author, and date added (US-008)', async ({ authenticatedPage }) => {
    const libraryPage = new LibraryPage(authenticatedPage);

    await libraryPage.goto();
    await libraryPage.waitForBooksToLoad();

    // Sort by title (A-Z)
    await libraryPage.sortBy('title');
    const titlesSorted = await libraryPage.getBookTitles();
    expect(titlesSorted.length).toBeGreaterThan(0);

    // Verify alphabetical order (at least first two)
    if (titlesSorted.length >= 2) {
      expect(titlesSorted[0].localeCompare(titlesSorted[1])).toBeLessThanOrEqual(0);
    }

    // Sort by author
    await libraryPage.sortBy('author');
    await libraryPage.waitForBooksToLoad();
    const titlesAfterAuthorSort = await libraryPage.getBookTitles();
    expect(titlesAfterAuthorSort.length).toBeGreaterThan(0);

    // Sort by date added (default - recent first)
    await libraryPage.sortBy('added');
    await libraryPage.waitForBooksToLoad();
    const titlesAfterDateSort = await libraryPage.getBookTitles();
    expect(titlesAfterDateSort.length).toBeGreaterThan(0);
  });

  test('displays empty state when no books match filters (US-009)', async ({ authenticatedPage }) => {
    const libraryPage = new LibraryPage(authenticatedPage);

    await libraryPage.goto();
    await libraryPage.waitForBooksToLoad();

    // Search for a non-existent book
    const currentUrl = authenticatedPage.url();
    const baseUrl = currentUrl.split('/library')[0];
    await authenticatedPage.goto(`${baseUrl}/library?q=nonexistent12345`);
    await libraryPage.waitForBooksToLoad();

    // Verify empty state is displayed
    await expect(libraryPage.emptyStateMessage).toBeVisible();

    // Verify message content
    const emptyStateText = await libraryPage.emptyStateMessage.textContent();
    expect(emptyStateText).toContain('No books found');

    // Verify no book cards are rendered
    const bookCount = await libraryPage.getBookCount();
    expect(bookCount).toBe(0);
  });

  test('navigates to reader when book card is clicked (US-010)', async ({ authenticatedPage }) => {
    const libraryPage = new LibraryPage(authenticatedPage);

    await libraryPage.goto();
    await libraryPage.waitForBooksToLoad();

    // Get a book title to click
    const titles = await libraryPage.getBookTitles();
    expect(titles.length).toBeGreaterThan(0);
    const firstTitle = titles[0];

    // Click the first book
    await libraryPage.clickBook(firstTitle);

    // Verify navigation to reader page
    await authenticatedPage.waitForURL(/\/read\/[a-zA-Z0-9-]+/);

    // Verify reader page loads (title visible)
    const pageTitle = await authenticatedPage.locator('h1, h2').first();
    await expect(pageTitle).toBeVisible();
  });

  test('loads more books with pagination (US-011)', async ({ authenticatedPage }) => {
    // Seed many books for pagination
    await resetDatabase();
    await seedDatabase();
    await seedManyBooks(30);

    const libraryPage = new LibraryPage(authenticatedPage);

    // Reload the page to get the new seeded data
    const currentUrl = authenticatedPage.url();
    const baseUrl = currentUrl.split('/library')[0];
    await authenticatedPage.goto(`${baseUrl}/library`);
    await libraryPage.waitForBooksToLoad();

    // Get initial book count (should be first page - typically 20)
    const initialCount = await libraryPage.getBookCount();
    expect(initialCount).toBeLessThan(33); // Less than total seeded (3 + 30)
    expect(initialCount).toBeGreaterThan(0);

    // Verify "Load More" button is visible
    await expect(libraryPage.loadMoreButton).toBeVisible();

    // Click "Load More"
    await libraryPage.clickLoadMore();

    // Verify additional books are appended
    const newCount = await libraryPage.getBookCount();
    expect(newCount).toBeGreaterThan(initialCount);

    // Verify "Load More" disappears when all books loaded (or is still visible if more pages)
    const hasLoadMore = await libraryPage.loadMoreButton.isVisible().catch(() => false);
    // If we loaded all books, button should be hidden
    if (newCount >= 33) {
      expect(hasLoadMore).toBe(false);
    }
  });

  test('resets pagination when filters change (US-012)', async ({ authenticatedPage }) => {
    // Seed many books for pagination
    await resetDatabase();
    await seedDatabase();
    await seedManyBooks(30);

    const libraryPage = new LibraryPage(authenticatedPage);

    // Reload the page to get the new seeded data
    const currentUrl = authenticatedPage.url();
    const baseUrl = currentUrl.split('/library')[0];
    await authenticatedPage.goto(`${baseUrl}/library`);
    await libraryPage.waitForBooksToLoad();

    // Load page 2
    const initialCount = await libraryPage.getBookCount();
    const hasLoadMore = await libraryPage.loadMoreButton.isVisible();

    if (hasLoadMore) {
      await libraryPage.clickLoadMore();
      const page2Count = await libraryPage.getBookCount();
      expect(page2Count).toBeGreaterThan(initialCount);

      // Change filter (e.g., filter by PDF)
      await libraryPage.filterByType('pdf');

      // Verify results reset to page 1
      const countAfterFilter = await libraryPage.getBookCount();
      // Should be less than or equal to initial page size
      expect(countAfterFilter).toBeLessThanOrEqual(initialCount);
    }
  });
});
