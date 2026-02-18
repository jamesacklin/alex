import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth.fixture';
import { CollectionsPage } from '../page-objects/collections.page';
import { LibraryPage } from '../page-objects/library.page';
import { CollectionDetailPage } from '../page-objects/collection-detail.page';

function appUrl(page: Page, path: string): string {
  return new URL(page.url()).origin + path;
}

async function createCollection(
  collectionsPage: CollectionsPage,
  name: string,
  description: string,
): Promise<void> {
  await collectionsPage.createCollectionButton.click();
  await expect(collectionsPage.createCollectionDialog).toBeVisible();
  await collectionsPage.collectionNameInput.fill(name);
  await collectionsPage.collectionDescriptionInput.fill(description);
  await collectionsPage.saveCollectionButton.click();
  await expect(collectionsPage.collectionCardByName(name)).toBeVisible();
}

async function addBookToCollectionFromLibrary(
  page: Page,
  bookTitle: string,
  collectionName: string,
): Promise<void> {
  const targetCard = page.locator('a[href^="/read/"]').filter({
    has: page.locator('h3', { hasText: bookTitle }),
  }).first();

  await expect(targetCard).toBeVisible();
  await targetCard.getByRole('button', { name: /add to collection/i }).click();

  const dialog = page.getByRole('dialog', { name: /add to collection/i });
  const option = dialog.getByRole('checkbox', { name: collectionName });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: /^Done$/ }).click();
  await expect(dialog).toBeHidden();
}

async function shareCollectionAndGetLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: /^Share$/ }).click();
  const shareDialog = page.getByRole('dialog', { name: /^Share Collection$/ });
  await shareDialog.waitFor({ state: 'visible' });
  await shareDialog.getByRole('button', { name: /^Enable Sharing$/ }).click();

  const shareUrlInput = page.getByRole('textbox', { name: /^Share URL$/ });
  await expect(shareUrlInput).toBeVisible();
  const shareUrl = await shareUrlInput.inputValue();
  expect(shareUrl).toMatch(/\/shared\/[^/]+$/);
  return shareUrl;
}

test.describe('Collections', () => {
  test('creates a new collection (US-003)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionName = `Science Fiction ${Date.now()}`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await createCollection(collectionsPage, collectionName, 'Books set in speculative futures.');
    await expect(collectionsPage.collectionCardByName(collectionName)).toContainText(collectionName);
  });

  test('edits an existing collection (US-004)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const initialName = `Initial Collection ${Date.now()}`;
    const updatedName = `Updated Name ${Date.now()}`;
    const updatedDescription = 'Updated description for this collection.';

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await createCollection(collectionsPage, initialName, 'Original description');

    await collectionsPage.clickCollection(initialName);
    await authenticatedPage.getByRole('button', { name: /^Edit$/ }).click();
    await authenticatedPage.getByRole('dialog', { name: /^Edit Collection$/ }).waitFor({ state: 'visible' });

    await authenticatedPage.getByRole('textbox', { name: /^Name$/ }).fill(updatedName);
    await authenticatedPage.getByRole('textbox', { name: /^Description$/ }).fill(updatedDescription);
    await authenticatedPage.getByRole('dialog', { name: /^Edit Collection$/ }).getByRole('button', { name: /^Save$/ }).click();

    await expect(authenticatedPage.getByRole('heading', { level: 1 })).toHaveText(updatedName);
    await expect(authenticatedPage.locator('h1 + p').first()).toContainText(updatedDescription);

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await expect(collectionsPage.collectionCardByName(updatedName)).toBeVisible();
  });

  test('deletes a collection without deleting books (US-005)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const libraryPage = new LibraryPage(authenticatedPage);
    const collectionName = `Delete Me ${Date.now()}`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/library'));
    await libraryPage.waitForBooksToLoad();
    const initialBookCount = await libraryPage.getBookCount();
    await expect(libraryPage.bookCardByTitle('Sample PDF Book')).toBeVisible();

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await createCollection(collectionsPage, collectionName, 'Temporary collection');
    await collectionsPage.clickCollection(collectionName);

    await authenticatedPage.getByRole('button', { name: /^Delete$/ }).click();
    await authenticatedPage.getByRole('dialog', { name: /^Delete collection\\?$/ }).waitFor({ state: 'visible' });
    await authenticatedPage.getByRole('dialog', { name: /^Delete collection\\?$/ }).getByRole('button', { name: /^Delete$/ }).click();

    await authenticatedPage.waitForURL(/\/collections$/, { timeout: 10000 });
    await expect(collectionsPage.collectionCardByName(collectionName)).toHaveCount(0);

    await authenticatedPage.goto(appUrl(authenticatedPage, '/library'));
    await libraryPage.waitForBooksToLoad();
    await expect(libraryPage.bookCardByTitle('Sample PDF Book')).toBeVisible();
    expect(await libraryPage.getBookCount()).toBeGreaterThanOrEqual(initialBookCount);
  });

  test('adds books to a collection (US-006)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionDetailPage = new CollectionDetailPage(authenticatedPage);
    const collectionName = `Add Books ${Date.now()}`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await createCollection(collectionsPage, collectionName, 'Collection for adding books');

    await authenticatedPage.goto(appUrl(authenticatedPage, '/library'));
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample EPUB Book', collectionName);

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await collectionsPage.clickCollection(collectionName);

    await expect(collectionDetailPage.bookCards.filter({ hasText: 'Sample PDF Book' })).toHaveCount(1);
    await expect(collectionDetailPage.bookCards.filter({ hasText: 'Sample EPUB Book' })).toHaveCount(1);
    await expect(authenticatedPage.getByText(/Showing 2 of 2 books/)).toBeVisible();
  });

  test('removes a book from a collection without deleting it from library (US-007)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionDetailPage = new CollectionDetailPage(authenticatedPage);
    const libraryPage = new LibraryPage(authenticatedPage);
    const collectionName = `Remove Books ${Date.now()}`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await createCollection(collectionsPage, collectionName, 'Collection for removing books');

    await authenticatedPage.goto(appUrl(authenticatedPage, '/library'));
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample EPUB Book', collectionName);

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await collectionsPage.clickCollection(collectionName);
    await expect(authenticatedPage.getByText(/Showing 2 of 2 books/)).toBeVisible();

    await collectionDetailPage.removeBookFromCollection('Sample EPUB Book');
    await expect(collectionDetailPage.bookCards.filter({ hasText: 'Sample EPUB Book' })).toHaveCount(0);
    await expect(collectionDetailPage.bookCards.filter({ hasText: 'Sample PDF Book' })).toHaveCount(1);
    await expect(authenticatedPage.getByText(/Showing 1 of 1 book/)).toBeVisible();

    await authenticatedPage.goto(appUrl(authenticatedPage, '/library'));
    await libraryPage.waitForBooksToLoad();
    await expect(libraryPage.bookCardByTitle('Sample EPUB Book')).toBeVisible();
  });

  test('shares a collection and generates a public link (US-008)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionName = `Shared Collection ${Date.now()}`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await createCollection(collectionsPage, collectionName, 'Collection to share');

    await authenticatedPage.goto(appUrl(authenticatedPage, '/library'));
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await collectionsPage.clickCollection(collectionName);

    const shareUrl = await shareCollectionAndGetLink(authenticatedPage);
    await collectionsPage.copyShareLinkButton.click();
    expect(shareUrl).toContain('/shared/');

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await expect(
      collectionsPage.collectionCardByName(collectionName).locator('[title="This collection is publicly shared"]'),
    ).toBeVisible();
  });
});
