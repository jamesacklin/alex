import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth.fixture';
import { CollectionsPage } from '../page-objects/collections.page';

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
});
