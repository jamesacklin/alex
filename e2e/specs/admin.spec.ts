import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth.fixture';
import { test as appTest } from '../fixtures/app.fixture';
import { AdminUsersPage } from '../page-objects/admin-users.page';
import { AdminLibraryPage } from '../page-objects/admin-library.page';
import { LoginPage } from '../page-objects/login.page';
import { LibraryPage } from '../page-objects/library.page';

function appUrl(page: Page, path: string): string {
  const defaultOrigin = process.env.E2E_PLATFORM === 'electron'
    ? 'http://localhost:3210'
    : 'http://localhost:3000';
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') {
    return `${defaultOrigin}${path}`;
  }
  try {
    const parsed = new URL(currentUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin + path;
    }
  } catch {
    return `${defaultOrigin}${path}`;
  }
  return `${defaultOrigin}${path}`;
}

test.describe('Admin Settings', () => {
  test('admin can create users (US-003)', async ({ authenticatedPage }) => {
    const adminUsersPage = new AdminUsersPage(authenticatedPage);
    const nonce = Date.now();
    const email = `newuser-${nonce}@localhost`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/admin/users'));
    await adminUsersPage.createUser(email, 'New User', 'password123', 'user');

    await expect(adminUsersPage.userRowByEmail(email)).toBeVisible();
    await expect(adminUsersPage.userRowByEmail(email)).toContainText('New User');
    await expect(adminUsersPage.userRowByEmail(email)).toContainText('user');
  });

  test('admin can edit users (US-004)', async ({ authenticatedPage }) => {
    const adminUsersPage = new AdminUsersPage(authenticatedPage);
    const nonce = Date.now();
    const email = `edit-user-${nonce}@localhost`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/admin/users'));
    await adminUsersPage.createUser(email, 'Editable User', 'password123', 'user');

    await adminUsersPage.editUserButton(email).click();
    const editDialog = authenticatedPage.getByRole('dialog', { name: /edit user/i });
    await expect(editDialog).toBeVisible();

    await editDialog.getByRole('textbox', { name: /display name/i }).fill('Updated Name');
    await editDialog.locator('button[role="combobox"]').click();
    await authenticatedPage.getByRole('option', { name: /^admin$/i }).click();
    await editDialog.getByRole('button', { name: /save changes/i }).click();

    await expect(adminUsersPage.userRowByEmail(email)).toContainText('Updated Name');
    await expect(adminUsersPage.userRowByEmail(email)).toContainText('admin');
  });

  test('admin can delete users (US-005)', async ({ authenticatedPage }) => {
    const adminUsersPage = new AdminUsersPage(authenticatedPage);
    const nonce = Date.now();
    const email = `delete-user-${nonce}@localhost`;

    await authenticatedPage.goto(appUrl(authenticatedPage, '/admin/users'));
    await adminUsersPage.createUser(email, 'Delete Me', 'password123', 'user');
    await expect(adminUsersPage.userRowByEmail(email)).toBeVisible();

    await adminUsersPage.deleteUser(email);
    await expect(adminUsersPage.userRowByEmail(email)).toHaveCount(0);
  });

  test('admin library path setting visibility is electron-only (US-007)', async ({ authenticatedPage }) => {
    const adminLibraryPage = new AdminLibraryPage(authenticatedPage);

    await authenticatedPage.goto(appUrl(authenticatedPage, '/admin/library'));
    await expect(authenticatedPage).toHaveURL(/\/admin\/library/, { timeout: 10000 });

    if (process.env.E2E_PLATFORM === 'electron') {
      await expect(
        authenticatedPage.getByText('Library Directory', { exact: true }).first(),
      ).toBeVisible({ timeout: 15000 });
      await expect(adminLibraryPage.changeLibraryPathButton).toBeVisible({ timeout: 15000 });
    } else {
      await expect(authenticatedPage.getByRole('heading', { name: /library directory/i })).toHaveCount(0);
      await expect(adminLibraryPage.changeLibraryPathButton).toHaveCount(0);
    }
  });

  test('admin can clear the library (US-008)', async ({ authenticatedPage }) => {
    const adminLibraryPage = new AdminLibraryPage(authenticatedPage);
    const libraryPage = new LibraryPage(authenticatedPage);

    await authenticatedPage.goto(appUrl(authenticatedPage, '/admin/library'));
    await adminLibraryPage.clickClearLibrary();
    await expect(authenticatedPage.getByText(/library cleared/i)).toBeVisible({ timeout: 15000 });

    await authenticatedPage.goto(appUrl(authenticatedPage, '/library'));
    await libraryPage.waitForBooksToLoad();
    await expect(libraryPage.emptyStateMessage).toBeVisible({ timeout: 20000 });
    expect(await libraryPage.getBookCount()).toBe(0);
  });
});

appTest('non-admin cannot access admin routes (US-006)', async ({ appPage }) => {
  appTest.skip(
    process.env.E2E_PLATFORM === 'electron',
    'Electron desktop mode always uses synthetic admin auth',
  );

  const loginPage = new LoginPage(appPage);

  await appPage.goto(appUrl(appPage, '/login'));
  await loginPage.login('user@localhost', 'user123');
  await expect(appPage).toHaveURL(/\/library/, { timeout: 10000 });

  await appPage.goto(appUrl(appPage, '/admin/users'));
  await expect(appPage).toHaveURL(/\/library/, { timeout: 10000 });
  await expect(appPage.getByRole('button', { name: /add user/i })).toHaveCount(0);
  await expect(appPage.getByRole('table')).toHaveCount(0);
});
