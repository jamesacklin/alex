import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth.fixture';
import { AdminUsersPage } from '../page-objects/admin-users.page';

function appUrl(page: Page, path: string): string {
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') {
    return `http://localhost:3000${path}`;
  }
  return new URL(currentUrl).origin + path;
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
});
