/* eslint-disable react-hooks/rules-of-hooks */
// Playwright's fixture `use()` function is not a React hook
import { test as base } from './app.fixture';
import { LoginPage } from '../page-objects/login.page';
import type { Page } from '@playwright/test';

type AuthFixture = {
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixture>({
  authenticatedPage: async ({ appPage }, use) => {
    // In Electron desktop mode, app is already authenticated
    if (process.env.E2E_PLATFORM === 'electron') {
      // Desktop mode has synthetic auth, already on /library
      await use(appPage);
      return;
    }

    // Web mode: perform login
    await appPage.goto('/login');

    // Use LoginPage to perform login
    const loginPage = new LoginPage(appPage);
    await loginPage.login('admin@localhost', 'admin123');

    // Verify successful login by checking redirect to /library
    await appPage.waitForURL('**/library', { timeout: 10000 });

    // Provide the authenticated page to the test
    await use(appPage);
  },
});

export { expect } from '@playwright/test';
