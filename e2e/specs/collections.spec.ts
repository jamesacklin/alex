import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth.fixture';
import { CollectionsPage } from '../page-objects/collections.page';
import { LibraryPage } from '../page-objects/library.page';
import { CollectionDetailPage } from '../page-objects/collection-detail.page';

function appUrl(page: Page, path: string): string {
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') {
    return `http://localhost:3000${path}`;
  }
  return new URL(currentUrl).origin + path;
}

async function gotoStable(page: Page, target: string): Promise<void> {
  const url = /^https?:\/\//.test(target) ? target : appUrl(page, target);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
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

async function createCollection(
  collectionsPage: CollectionsPage,
  name: string,
  description: string,
): Promise<void> {
  await expect(collectionsPage.createCollectionButton).toBeVisible({ timeout: 10000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await collectionsPage.createCollectionButton.click({ noWaitAfter: true, force: true });
    if (await collectionsPage.createCollectionDialog.isVisible()) {
      break;
    }
    await collectionsPage.page.waitForTimeout(250);
  }
  await expect(collectionsPage.createCollectionDialog).toBeVisible({ timeout: 10000 });
  await collectionsPage.collectionNameInput.fill(name);
  await collectionsPage.collectionDescriptionInput.fill(description);
  await collectionsPage.saveCollectionButton.click();
  await expect(collectionsPage.collectionCardByName(name)).toBeVisible();
}

async function createCollectionViaApi(
  page: Page,
  name: string,
  description: string,
): Promise<void> {
  const response = await page.request.post(appUrl(page, '/api/collections'), {
    data: { name, description },
  });
  expect(response.ok()).toBeTruthy();
  await gotoStable(page, '/collections');
  await expect(
    page.locator('a[href^="/collections/"]').filter({ hasText: name }).first(),
  ).toBeVisible({ timeout: 10000 });
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
  await expect(dialog).toBeVisible({ timeout: 10000 });
  const option = dialog.getByRole('checkbox', { name: collectionName }).first();
  await option.click({ force: true });
  await dialog.getByRole('button', { name: /^Done$/ }).click({ noWaitAfter: true, force: true });
  await expect(dialog).toBeHidden({ timeout: 10000 });
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
  test.skip(
    process.env.E2E_PLATFORM === 'electron' && process.env.E2E_FORCE_COLLECTIONS_ELECTRON !== '1',
    'Collections flows are validated in web mode',
  );

  test('creates a new collection (US-003)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionName = `Science Fiction ${Date.now()}`;

    await gotoStable(authenticatedPage, '/collections');
    await createCollection(collectionsPage, collectionName, 'Books set in speculative futures.');
    await expect(collectionsPage.collectionCardByName(collectionName)).toContainText(collectionName);
  });

  test('edits an existing collection (US-004)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const initialName = `Initial Collection ${Date.now()}`;
    const updatedName = `Updated Name ${Date.now()}`;
    const updatedDescription = 'Updated description for this collection.';

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, initialName, 'Original description');

    await collectionsPage.clickCollection(initialName);
    await authenticatedPage.getByRole('button', { name: /^Edit$/ }).click();
    await authenticatedPage.getByRole('dialog', { name: /^Edit Collection$/ }).waitFor({ state: 'visible' });

    await authenticatedPage.getByRole('textbox', { name: /^Name$/ }).fill(updatedName);
    await authenticatedPage.getByRole('textbox', { name: /^Description$/ }).fill(updatedDescription);
    await authenticatedPage.getByRole('dialog', { name: /^Edit Collection$/ }).getByRole('button', { name: /^Save$/ }).click();

    await expect(authenticatedPage.getByRole('heading', { name: updatedName })).toBeVisible();
    await expect(authenticatedPage.locator('main').getByText(updatedDescription)).toBeVisible();

    await gotoStable(authenticatedPage, '/collections');
    await expect(collectionsPage.collectionCardByName(updatedName)).toBeVisible();
  });

  test('deletes a collection without deleting books (US-005)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const libraryPage = new LibraryPage(authenticatedPage);
    const collectionName = `Delete Me ${Date.now()}`;

    await gotoStable(authenticatedPage, '/library');
    await libraryPage.waitForBooksToLoad();
    const initialBookCount = await libraryPage.getBookCount();
    await expect(libraryPage.bookCardByTitle('Sample PDF Book')).toBeVisible();

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, collectionName, 'Temporary collection');
    await collectionsPage.clickCollection(collectionName);

    await authenticatedPage.getByRole('button', { name: /^Delete$/ }).click();
    const deleteDialog = authenticatedPage.getByRole('alertdialog').filter({ hasText: /Delete collection/i });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: /^Delete$/ }).click();

    await authenticatedPage.waitForURL(/\/collections$/, { timeout: 10000 });
    await expect(collectionsPage.collectionCardByName(collectionName)).toHaveCount(0);

    await gotoStable(authenticatedPage, '/library');
    await libraryPage.waitForBooksToLoad();
    await expect(libraryPage.bookCardByTitle('Sample PDF Book')).toBeVisible();
    expect(await libraryPage.getBookCount()).toBeGreaterThanOrEqual(initialBookCount);
  });

  test('adds books to a collection (US-006)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionDetailPage = new CollectionDetailPage(authenticatedPage);
    const collectionName = `Add Books ${Date.now()}`;

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, collectionName, 'Collection for adding books');

    await gotoStable(authenticatedPage, '/library');
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample EPUB Book', collectionName);

    await gotoStable(authenticatedPage, '/collections');
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

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, collectionName, 'Collection for removing books');

    await gotoStable(authenticatedPage, '/library');
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample EPUB Book', collectionName);

    await gotoStable(authenticatedPage, '/collections');
    await collectionsPage.clickCollection(collectionName);
    await expect(authenticatedPage.getByText(/Showing 2 of 2 books/)).toBeVisible();

    await collectionDetailPage.removeBookFromCollection('Sample EPUB Book');
    await expect(collectionDetailPage.bookCards.filter({ hasText: 'Sample EPUB Book' })).toHaveCount(0);
    await expect(collectionDetailPage.bookCards.filter({ hasText: 'Sample PDF Book' })).toHaveCount(1);
    await expect(authenticatedPage.getByText(/Showing 1 of 1 book/)).toBeVisible();

    await gotoStable(authenticatedPage, '/library');
    await libraryPage.waitForBooksToLoad();
    await expect(libraryPage.bookCardByTitle('Sample EPUB Book')).toBeVisible();
  });

  test('shares a collection and generates a public link (US-008)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionName = `Shared Collection ${Date.now()}`;

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, collectionName, 'Collection to share');

    await gotoStable(authenticatedPage, '/library');
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);

    await gotoStable(authenticatedPage, '/collections');
    await collectionsPage.clickCollection(collectionName);

    const shareUrl = await shareCollectionAndGetLink(authenticatedPage);
    await collectionsPage.copyShareLinkButton.click();
    expect(shareUrl).toContain('/shared/');

    await gotoStable(authenticatedPage, '/collections');
    await expect(
      collectionsPage.collectionCardByName(collectionName).locator('[title="This collection is publicly shared"]'),
    ).toBeVisible();
  });

  test('opens shared collection without authentication in read-only mode (US-009)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionName = `Public Collection ${Date.now()}`;

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, collectionName, 'Publicly visible collection');

    await gotoStable(authenticatedPage, '/library');
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);

    await gotoStable(authenticatedPage, '/collections');
    await collectionsPage.clickCollection(collectionName);
    const shareUrl = await shareCollectionAndGetLink(authenticatedPage);

    const browser = authenticatedPage.context().browser();
    if (browser) {
      const unauthContext = await browser.newContext();
      const unauthPage = await unauthContext.newPage();

      await unauthPage.goto(shareUrl);
      await expect(unauthPage).toHaveURL(/\/shared\/[^/]+$/);
      await expect(unauthPage.getByRole('heading', { level: 1, name: collectionName })).toBeVisible();
      await expect(unauthPage.getByText('Sample PDF Book')).toBeVisible();
      await expect(unauthPage.getByRole('button', { name: /remove from collection|edit|delete/i })).toHaveCount(0);

      await unauthContext.close();
      return;
    }

    await gotoStable(authenticatedPage, shareUrl);
    await expect(authenticatedPage).toHaveURL(/\/shared\/[^/]+$/);
    await expect(authenticatedPage.getByRole('heading', { level: 1, name: collectionName })).toBeVisible();
    await expect(authenticatedPage.getByText('Sample PDF Book')).toBeVisible();
    await expect(authenticatedPage.getByRole('button', { name: /remove from collection|edit|delete/i })).toHaveCount(0);
  });

  test('revokes shared link access when collection is unshared (US-010)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionName = `Unshare Collection ${Date.now()}`;

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, collectionName, 'Collection to unshare');

    await gotoStable(authenticatedPage, '/library');
    await addBookToCollectionFromLibrary(authenticatedPage, 'Sample PDF Book', collectionName);

    await gotoStable(authenticatedPage, '/collections');
    await collectionsPage.clickCollection(collectionName);
    const shareUrl = await shareCollectionAndGetLink(authenticatedPage);

    await authenticatedPage.getByRole('button', { name: /^Stop Sharing$/ }).click();
    const stopSharingDialog = authenticatedPage.getByRole('alertdialog').filter({
      hasText: /Stop sharing this collection/i,
    });
    await expect(stopSharingDialog).toBeVisible();
    await stopSharingDialog.getByRole('button', { name: /^Stop Sharing$/ }).click();

    await expect(authenticatedPage.getByRole('button', { name: /^Share$/ })).toBeVisible();
    await expect(authenticatedPage.getByRole('textbox', { name: /^Share URL$/ })).toHaveCount(0);

    await gotoStable(authenticatedPage, '/collections');
    await expect(
      collectionsPage.collectionCardByName(collectionName).locator('[title="This collection is publicly shared"]'),
    ).toHaveCount(0);

    await gotoStable(authenticatedPage, shareUrl);
    await expect(authenticatedPage.getByRole('heading', { name: /Collection Not Found/i })).toBeVisible();
  });

  test('filters collections by all/private/shared status (US-011)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const privateCollectionName = `Private Collection ${Date.now()}`;
    const sharedCollectionName = `Shared Collection ${Date.now()}`;

    await gotoStable(authenticatedPage, '/collections');
    await createCollectionViaApi(authenticatedPage, privateCollectionName, 'Private collection');
    await createCollectionViaApi(authenticatedPage, sharedCollectionName, 'Shared collection');

    await collectionsPage.clickCollection(sharedCollectionName);
    await shareCollectionAndGetLink(authenticatedPage);
    await gotoStable(authenticatedPage, '/collections');

    await collectionsPage.filterBy('shared');
    await expect(collectionsPage.collectionCardByName(sharedCollectionName)).toBeVisible();
    await expect(collectionsPage.collectionCardByName(privateCollectionName)).toHaveCount(0);

    await collectionsPage.filterBy('private');
    await expect(collectionsPage.collectionCardByName(privateCollectionName)).toBeVisible();
    await expect(collectionsPage.collectionCardByName(sharedCollectionName)).toHaveCount(0);

    await collectionsPage.filterBy('all');
    await expect(collectionsPage.collectionCardByName(privateCollectionName)).toBeVisible();
    await expect(collectionsPage.collectionCardByName(sharedCollectionName)).toBeVisible();
  });
});
