import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/auth.fixture';
import { PdfReaderPage } from '../page-objects/pdf-reader.page';
import { resetDatabase, seedDatabase } from '../helpers/db';

const PDF_BOOK_ID = 'book-pdf-1';
const PDF_BOOK_TITLE = 'Sample PDF Book';

// Electron does not set a baseURL, so relative URLs fail in page.goto().
// Use the current page's origin to construct absolute URLs.
function appUrl(page: Page, path: string): string {
  return new URL(page.url()).origin + path;
}

test.describe('PDF Reader', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto(appUrl(authenticatedPage, `/read/${PDF_BOOK_ID}`));
  });

  test('opens and renders first page (US-003)', async ({ authenticatedPage }) => {
    const reader = new PdfReaderPage(authenticatedPage);

    await reader.waitForLoad();

    // Verify page 1 is displayed
    const currentPage = await reader.getCurrentPage();
    expect(currentPage).toBe(1);

    // Verify total pages are available
    const totalPages = await reader.getTotalPages();
    expect(totalPages).toBeGreaterThan(0);

    // Verify PDF canvas is visible (react-pdf renders a canvas element)
    await expect(authenticatedPage.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // Verify the book title is shown in the toolbar
    await expect(authenticatedPage.getByText(PDF_BOOK_TITLE)).toBeVisible();
  });

  test('navigates between pages with next/previous buttons (US-004)', async ({ authenticatedPage }) => {
    const reader = new PdfReaderPage(authenticatedPage);

    await reader.waitForLoad();
    const totalPages = await reader.getTotalPages();
    expect(totalPages).toBeGreaterThanOrEqual(2);

    // Verify "Previous" button is disabled on page 1
    await expect(reader.previousPageButton).toBeDisabled();

    // Navigate to next page
    await reader.clickNextPage();

    // Wait for page number to update
    await authenticatedPage.waitForFunction(
      () => {
        const input = document.querySelector('header input[type="number"]') as HTMLInputElement | null;
        return input !== null && parseInt(input.value, 10) === 2;
      },
      { timeout: 10000 },
    );

    const pageAfterNext = await reader.getCurrentPage();
    expect(pageAfterNext).toBe(2);

    // Navigate back to previous page
    await reader.clickPreviousPage();

    await authenticatedPage.waitForFunction(
      () => {
        const input = document.querySelector('header input[type="number"]') as HTMLInputElement | null;
        return input !== null && parseInt(input.value, 10) === 1;
      },
      { timeout: 10000 },
    );

    const pageAfterPrev = await reader.getCurrentPage();
    expect(pageAfterPrev).toBe(1);

    // Verify "Previous" is disabled again on page 1
    await expect(reader.previousPageButton).toBeDisabled();

    // Navigate to the last page and verify "Next" is disabled
    await reader.clickNextPage();

    await authenticatedPage.waitForFunction(
      () => {
        const input = document.querySelector('header input[type="number"]') as HTMLInputElement | null;
        return input !== null && parseInt(input.value, 10) >= 2;
      },
      { timeout: 10000 },
    );

    if (totalPages === 2) {
      await expect(reader.nextPageButton).toBeDisabled();
    }
  });

  test('jumps to a specific page using the page input (US-005)', async ({ authenticatedPage }) => {
    const reader = new PdfReaderPage(authenticatedPage);

    await reader.waitForLoad();
    const totalPages = await reader.getTotalPages();
    expect(totalPages).toBeGreaterThanOrEqual(2);

    // Jump to the last page (page 2 for our 2-page fixture)
    const targetPage = totalPages;
    await reader.jumpToPage(targetPage);

    await authenticatedPage.waitForFunction(
      (expected: number) => {
        const input = document.querySelector('header input[type="number"]') as HTMLInputElement | null;
        return input !== null && parseInt(input.value, 10) === expected;
      },
      targetPage,
      { timeout: 10000 },
    );

    const currentPage = await reader.getCurrentPage();
    expect(currentPage).toBe(targetPage);
  });

  test('zooms in and out (US-006)', async ({ authenticatedPage }) => {
    const reader = new PdfReaderPage(authenticatedPage);

    await reader.waitForLoad();

    // Get the initial zoom level
    const initialZoom = await reader.getZoomPercent();

    // Zoom in
    await reader.zoomIn();
    await authenticatedPage.waitForTimeout(300);
    const zoomedInLevel = await reader.getZoomPercent();
    expect(zoomedInLevel).toBeGreaterThan(initialZoom);

    // Zoom out (back toward initial)
    await reader.zoomOut();
    await authenticatedPage.waitForTimeout(300);
    const zoomedOutLevel = await reader.getZoomPercent();
    expect(zoomedOutLevel).toBeLessThan(zoomedInLevel);
  });

  test('tracks and persists reading progress (US-007)', async ({ authenticatedPage }) => {
    await resetDatabase();
    await seedDatabase();

    const origin = new URL(authenticatedPage.url()).origin;
    const isElectron = process.env.E2E_PLATFORM === 'electron';

    // Re-authenticate after db reset (web only; Electron uses synthetic auth)
    if (!isElectron) {
      await authenticatedPage.goto(`${origin}/login`);
      await authenticatedPage.fill('input[type="email"]', 'admin@localhost');
      await authenticatedPage.fill('input[type="password"]', 'admin123');
      await authenticatedPage.click('button[type="submit"]');
      await authenticatedPage.waitForURL('**/library', { timeout: 10000 });
    }

    // Open the PDF book
    await authenticatedPage.goto(`${origin}/read/${PDF_BOOK_ID}`);

    const reader = new PdfReaderPage(authenticatedPage);
    await reader.waitForLoad();

    const totalPages = await reader.getTotalPages();
    expect(totalPages).toBeGreaterThanOrEqual(2);

    // Navigate to the last page to set progress
    const targetPage = totalPages;
    await reader.clickNextPage();

    await authenticatedPage.waitForFunction(
      (expected: number) => {
        const input = document.querySelector('header input[type="number"]') as HTMLInputElement | null;
        return input !== null && parseInt(input.value, 10) === expected;
      },
      targetPage,
      { timeout: 10000 },
    );

    expect(await reader.getCurrentPage()).toBe(targetPage);

    // Wait for progress API call to complete (progress saves immediately on page change)
    await authenticatedPage.waitForTimeout(2000);

    // Navigate back to library
    await authenticatedPage.goto(`${origin}/library`);
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Reopen the same book
    await authenticatedPage.goto(`${origin}/read/${PDF_BOOK_ID}`);

    const reader2 = new PdfReaderPage(authenticatedPage);
    await reader2.waitForLoad();

    // Verify the book resumes at the last-read page
    const resumedPage = await reader2.getCurrentPage();
    expect(resumedPage).toBe(targetPage);
  });
});
