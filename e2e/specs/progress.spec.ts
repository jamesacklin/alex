import { and, eq } from 'drizzle-orm';
import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth.fixture';
import { LoginPage } from '../page-objects/login.page';
import { PdfReaderPage } from '../page-objects/pdf-reader.page';
import { resetDatabase, seedDatabase } from '../helpers/db';
import { db } from '../../src/lib/db';
import { readingProgress } from '../../src/lib/db/schema';

const PDF_BOOK_ID = 'book-pdf-1';
const ADMIN_EMAIL = 'admin@localhost';
const ADMIN_PASSWORD = 'admin123';
const USER_EMAIL = 'user@localhost';
const USER_PASSWORD = 'user123';

function appUrl(page: Page, path: string): string {
  return new URL(page.url()).origin + path;
}

function isElectronMode(): boolean {
  return process.env.E2E_PLATFORM === 'electron';
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  if (isElectronMode()) return;
  const loginPage = new LoginPage(page);
  await page.goto(appUrl(page, '/login'));
  await loginPage.login(email, password);
  await page.waitForURL('**/library', { timeout: 10000 });
}

async function logout(page: Page): Promise<void> {
  if (isElectronMode()) return;
  await page.goto(appUrl(page, '/admin/general'));
  await page.getByRole('button', { name: /log out/i }).click();
  await page.waitForURL('**/login', { timeout: 10000 });
}

async function openPdf(page: Page): Promise<PdfReaderPage> {
  await page.goto(appUrl(page, `/read/${PDF_BOOK_ID}`));
  const reader = new PdfReaderPage(page);
  await reader.waitForLoad();
  return reader;
}

async function savePdfProgressViaApi(page: Page, currentPage: number, totalPages: number): Promise<void> {
  const response = await page.evaluate(
    async ({ bookId, currentPageValue, totalPagesValue }) => {
      const res = await fetch(`/api/books/${bookId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPage: currentPageValue,
          totalPages: totalPagesValue,
        }),
      });
      return res.ok;
    },
    { bookId: PDF_BOOK_ID, currentPageValue: currentPage, totalPagesValue: totalPages },
  );

  expect(response).toBe(true);
}

async function readPdfProgressFromApi(page: Page): Promise<{
  currentPage: number;
  totalPages: number;
  percentComplete: number;
}> {
  const progress = await page.evaluate(async (bookId) => {
    const res = await fetch(`/api/books/${bookId}/progress`);
    return res.json();
  }, PDF_BOOK_ID);

  return progress;
}

test.describe('Reading Progress', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await resetDatabase();
    await seedDatabase();
    await loginAs(authenticatedPage, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('keeps progress independent between users for the same PDF (US-012)', async ({ authenticatedPage }) => {
    const readerForAdmin = await openPdf(authenticatedPage);
    const totalPages = await readerForAdmin.getTotalPages();
    expect(totalPages).toBeGreaterThanOrEqual(2);

    await readerForAdmin.jumpToPage(2);
    await expect.poll(() => readerForAdmin.getCurrentPage()).toBe(2);
    await authenticatedPage.waitForTimeout(2000);

    if (isElectronMode()) {
      const now = Math.floor(Date.now() / 1000);
      await db
        .delete(readingProgress)
        .where(and(eq(readingProgress.userId, '2'), eq(readingProgress.bookId, PDF_BOOK_ID)));
      await db.insert(readingProgress).values({
        id: crypto.randomUUID(),
        userId: '2',
        bookId: PDF_BOOK_ID,
        currentPage: 1,
        totalPages,
        percentComplete: 50,
        status: 'reading',
        lastReadAt: now,
      });

      const readerAfterUserBProgress = await openPdf(authenticatedPage);
      expect(await readerAfterUserBProgress.getCurrentPage()).toBe(2);
      return;
    }

    await logout(authenticatedPage);
    await loginAs(authenticatedPage, USER_EMAIL, USER_PASSWORD);

    const readerForUser = await openPdf(authenticatedPage);
    expect(await readerForUser.getCurrentPage()).toBe(1);
    await savePdfProgressViaApi(authenticatedPage, 1, totalPages);

    await logout(authenticatedPage);
    await loginAs(authenticatedPage, ADMIN_EMAIL, ADMIN_PASSWORD);

    const readerForAdminAgain = await openPdf(authenticatedPage);
    expect(await readerForAdminAgain.getCurrentPage()).toBe(2);
  });

  test('persists PDF progress to the progress API (US-013)', async ({ authenticatedPage }) => {
    const reader = await openPdf(authenticatedPage);
    const totalPages = await reader.getTotalPages();
    expect(totalPages).toBeGreaterThan(0);

    const targetPage = Math.min(2, totalPages);
    await reader.jumpToPage(targetPage);
    await expect.poll(() => reader.getCurrentPage()).toBe(targetPage);
    await authenticatedPage.waitForTimeout(2000);

    const progress = await readPdfProgressFromApi(authenticatedPage);
    expect(progress.currentPage).toBe(targetPage);
    expect(progress.totalPages).toBe(totalPages);
    expect(progress.percentComplete).toBeCloseTo((targetPage / totalPages) * 100, 2);
  });
});
