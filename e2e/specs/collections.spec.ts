import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth.fixture';
import { CollectionsPage } from '../page-objects/collections.page';

function appUrl(page: Page, path: string): string {
  return new URL(page.url()).origin + path;
}

test.describe('Collections', () => {
  test('creates a new collection (US-003)', async ({ authenticatedPage }) => {
    const collectionsPage = new CollectionsPage(authenticatedPage);
    const collectionName = `Science Fiction ${Date.now()}`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/collections'));
    await collectionsPage.createCollectionButton.click();
    await expect(collectionsPage.createCollectionDialog).toBeVisible();

    await collectionsPage.collectionNameInput.fill(collectionName);
    await collectionsPage.collectionDescriptionInput.fill('Books set in speculative futures.');
    await collectionsPage.saveCollectionButton.click();

    await expect(collectionsPage.collectionCardByName(collectionName)).toBeVisible();
    await expect(collectionsPage.collectionCardByName(collectionName)).toContainText(collectionName);
  });
});
