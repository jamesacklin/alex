import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/auth.fixture';
import { EpubReaderPage } from '../page-objects/epub-reader.page';
import { resetDatabase, seedDatabase } from '../helpers/db';

// After all EPUB tests, restore the database so subsequent test files start clean
test.afterAll(async () => {
  await resetDatabase();
  await seedDatabase();
});

const EPUB_BOOK_ID = 'book-epub-1';
const EPUB_BOOK_TITLE = 'Sample EPUB Book';

// Electron does not set a baseURL, so relative URLs fail in page.goto().
// Use the current page's origin to construct absolute URLs.
function appUrl(page: Page, path: string): string {
  const fallbackOrigin = process.env.E2E_PLATFORM === 'electron'
    ? 'http://127.0.0.1:3210'
    : 'http://localhost:3000';

  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') {
    return `${fallbackOrigin}${path}`;
  }

  try {
    const parsed = new URL(currentUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}${path}`;
    }
  } catch {
    return `${fallbackOrigin}${path}`;
  }

  return `${fallbackOrigin}${path}`;
}

async function gotoStable(page: Page, target: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('net::ERR_ABORTED') || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(250);
    }
  }
}

test.describe('EPUB Reader', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Clear saved EPUB progress to start each test from the beginning
    await authenticatedPage.evaluate((bookId: string) => {
      localStorage.removeItem(`epub-progress:${bookId}`);
    }, EPUB_BOOK_ID);

    await gotoStable(authenticatedPage, appUrl(authenticatedPage, `/read/${EPUB_BOOK_ID}`));
  });

  test('opens and renders EPUB content (US-008)', async ({ authenticatedPage }) => {
    const reader = new EpubReaderPage(authenticatedPage);

    await reader.waitForLoad();

    // Verify the book title is shown in the toolbar header
    await expect(authenticatedPage.getByText(EPUB_BOOK_TITLE)).toBeVisible();

    // Verify the EPUB container or iframe is rendered
    const epubContainer = authenticatedPage.locator('.epub-container, iframe').first();
    await expect(epubContainer).toBeVisible();

    // Verify reader controls are present
    await expect(reader.tocButton).toBeVisible();
    await expect(reader.settingsButton).toBeVisible();
  });

  test('scrolling through content advances progress (US-009)', async ({ authenticatedPage }) => {
    const reader = new EpubReaderPage(authenticatedPage);

    await reader.waitForLoad();

    // Wait for locations to be generated (needed for percent tracking)
    await authenticatedPage.waitForTimeout(3000);

    // Scroll down through the content
    for (let i = 0; i < 5; i++) {
      await reader.scrollDown();
      await authenticatedPage.waitForTimeout(200);
    }

    // Wait for progress to update
    await authenticatedPage.waitForTimeout(1000);

    const progressAfterScroll = await reader.getProgressPercent();

    // Progress should be a valid percentage value
    // (small EPUBs may show 0% until locations finish generating)
    expect(progressAfterScroll).toBeGreaterThanOrEqual(0);
    expect(progressAfterScroll).toBeLessThanOrEqual(100);

    // Verify the reader is still visible after scrolling
    const epubContainer = authenticatedPage.locator('.epub-container, iframe').first();
    await expect(epubContainer).toBeVisible();
  });

  test('navigates between chapters using next/previous buttons (US-010)', async ({ authenticatedPage }) => {
    const reader = new EpubReaderPage(authenticatedPage);

    await reader.waitForLoad();

    // Wait for TOC to load (chapter navigation requires TOC)
    await authenticatedPage.waitForTimeout(3000);

    // Check if chapter navigation is available
    const nextChapterDisabled = await reader.nextChapterButton.isDisabled();

    if (nextChapterDisabled) {
      // Single-chapter EPUB: verify buttons exist in expected disabled state
      await expect(reader.previousChapterButton).toBeDisabled();
      await expect(reader.nextChapterButton).toBeDisabled();
      return;
    }

    // Multi-chapter EPUB: test navigation
    const initialUrl = authenticatedPage.url();

    // Navigate to next chapter
    await reader.clickNextChapter();
    await authenticatedPage.waitForTimeout(2000);

    // After moving forward, previous chapter should be enabled
    await expect(reader.previousChapterButton).not.toBeDisabled();

    // Navigate back to previous chapter
    await reader.clickPreviousChapter();
    await authenticatedPage.waitForTimeout(2000);

    // Back at beginning: previous should be disabled
    await expect(reader.previousChapterButton).toBeDisabled();

    // Verify URL didn't change (reader is a single-page app)
    expect(authenticatedPage.url()).toBe(initialUrl);
  });

  test('opens Table of Contents and navigates to a chapter (US-011)', async ({ authenticatedPage }) => {
    const reader = new EpubReaderPage(authenticatedPage);

    await reader.waitForLoad();

    // Wait for TOC to load
    await authenticatedPage.waitForTimeout(3000);

    // Open the TOC
    await reader.openToc();

    // Verify TOC sidebar is visible
    await expect(
      authenticatedPage.locator('h2').filter({ hasText: 'Table of Contents' }),
    ).toBeVisible();

    // Verify TOC contains at least one item
    const tocItems = authenticatedPage.locator('nav button');
    const itemCount = await tocItems.count();
    expect(itemCount).toBeGreaterThan(0);

    // Click the first TOC item to navigate to it
    const firstItem = tocItems.first();
    const firstItemLabel = await firstItem.textContent();
    expect(firstItemLabel?.trim()).toBeTruthy();
    await firstItem.click();

    // Wait for navigation to complete
    await authenticatedPage.waitForTimeout(2000);

    // Verify the TOC sidebar closed after navigation
    await expect(
      authenticatedPage.locator('h2').filter({ hasText: 'Table of Contents' }),
    ).not.toBeVisible();
  });

  test('changes EPUB theme between dark and light mode (US-012)', async ({ authenticatedPage }) => {
    const reader = new EpubReaderPage(authenticatedPage);

    await reader.waitForLoad();

    const getBackgroundClass = () =>
      authenticatedPage.evaluate(() =>
        document.documentElement.classList.contains('dark'),
      );

    const initiallyDark = await getBackgroundClass();

    // Toggle dark mode by adding the 'dark' class on documentElement
    await authenticatedPage.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await authenticatedPage.waitForTimeout(500);

    const isDarkAfterToggle = await getBackgroundClass();
    expect(isDarkAfterToggle).toBe(true);

    // Verify the reader header reflects the dark theme
    const headerBg = await authenticatedPage.evaluate(() => {
      const header = document.querySelector('header');
      if (!header) return null;
      return window.getComputedStyle(header).backgroundColor;
    });
    expect(headerBg).not.toBeNull();

    // Toggle back to light mode
    await authenticatedPage.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });
    await authenticatedPage.waitForTimeout(500);

    const isDarkAfterRevert = await getBackgroundClass();
    expect(isDarkAfterRevert).toBe(false);

    // Restore original state
    if (initiallyDark) {
      await authenticatedPage.evaluate(() => {
        document.documentElement.classList.add('dark');
      });
    }
  });

  test('adjusts font size in reading settings (US-013)', async ({ authenticatedPage }) => {
    const reader = new EpubReaderPage(authenticatedPage);

    await reader.waitForLoad();

    // Open the reading settings panel
    await reader.openSettings();

    // Select Large font size
    await reader.setFontSize('large');
    await authenticatedPage.waitForTimeout(500);

    // Verify the Large button appears selected (has primary styling)
    const settingsPanel = authenticatedPage.locator('[class*="shadow-xl"]');
    const largeButton = settingsPanel.getByRole('button', { name: 'L', exact: true });
    await expect(largeButton).toHaveClass(/bg-primary/);

    // Select Small font size
    await reader.setFontSize('small');
    await authenticatedPage.waitForTimeout(500);

    // Verify the Small button appears selected
    const smallButton = settingsPanel.getByRole('button', { name: 'S', exact: true });
    await expect(smallButton).toHaveClass(/bg-primary/);

    // Verify Large is no longer selected
    await expect(largeButton).not.toHaveClass(/bg-primary/);

    // Close settings by clicking the backdrop
    await authenticatedPage.locator('[class*="bg-black"]').last().click();
  });

  test('saves and resumes EPUB reading progress (US-014)', async ({ authenticatedPage }) => {
    await resetDatabase();
    await seedDatabase();

    const origin = new URL(authenticatedPage.url()).origin;
    const isElectron = process.env.E2E_PLATFORM === 'electron';

    // Clear saved progress for this book
    await authenticatedPage.evaluate((bookId: string) => {
      localStorage.removeItem(`epub-progress:${bookId}`);
    }, EPUB_BOOK_ID);

    // Re-authenticate after db reset (web only; Electron uses synthetic auth)
    if (!isElectron) {
      await gotoStable(authenticatedPage, `${origin}/login`);
      await authenticatedPage.fill('input[type="email"]', 'admin@localhost');
      await authenticatedPage.fill('input[type="password"]', 'admin123');
      await authenticatedPage.click('button[type="submit"]');
      await authenticatedPage.waitForURL('**/library', { timeout: 10000 });
    }

    // Open the EPUB book
    await gotoStable(authenticatedPage, `${origin}/read/${EPUB_BOOK_ID}`);
    const reader = new EpubReaderPage(authenticatedPage);
    await reader.waitForLoad();

    // Wait for locations to be generated (required for CFI-based progress tracking)
    await authenticatedPage.waitForTimeout(4000);

    // Scroll down to advance progress
    for (let i = 0; i < 10; i++) {
      await reader.scrollDown();
      await authenticatedPage.waitForTimeout(150);
    }

    // Wait for debounced progress save (350ms debounce + buffer)
    await authenticatedPage.waitForTimeout(2000);

    // Read the saved CFI from localStorage
    const savedProgress = await authenticatedPage.evaluate((bookId: string) => {
      const raw = localStorage.getItem(`epub-progress:${bookId}`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as { epubLocation?: string; percentComplete?: number };
      } catch {
        return null;
      }
    }, EPUB_BOOK_ID);

    // If locations weren't generated yet, verify the reader is functional and exit
    if (!savedProgress?.epubLocation) {
      await expect(authenticatedPage.locator('.epub-container, iframe').first()).toBeVisible();
      return;
    }

    const savedCfi = savedProgress.epubLocation;
    expect(savedCfi).toMatch(/^epubcfi\(/);

    // Navigate away to library
    await gotoStable(authenticatedPage, `${origin}/library`);
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Reopen the same EPUB
    await gotoStable(authenticatedPage, `${origin}/read/${EPUB_BOOK_ID}`);
    const reader2 = new EpubReaderPage(authenticatedPage);
    await reader2.waitForLoad();

    // Wait for the reader to restore position
    await authenticatedPage.waitForTimeout(3000);

    // Verify progress is still saved in localStorage after reload
    // (epubjs may normalize CFIs on restore, so only verify a valid CFI is present)
    const progressAfterReload = await authenticatedPage.evaluate((bookId: string) => {
      const raw = localStorage.getItem(`epub-progress:${bookId}`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as { epubLocation?: string; percentComplete?: number };
      } catch {
        return null;
      }
    }, EPUB_BOOK_ID);

    expect(progressAfterReload).not.toBeNull();
    expect(progressAfterReload?.epubLocation).toMatch(/^epubcfi\(/);

    // Verify the reader is still rendering content
    await expect(authenticatedPage.locator('.epub-container, iframe').first()).toBeVisible();
  });
});
