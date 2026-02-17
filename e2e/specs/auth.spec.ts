import { test, expect } from '../fixtures/app.fixture';
import { test as authTest } from '../fixtures/auth.fixture';
import { LoginPage } from '../page-objects/login.page';

test.describe('Authentication', () => {
  test('should login successfully with valid credentials', async ({ appPage }) => {
    // Navigate to login page
    await appPage.goto('/login');

    // Create login page object and login
    const loginPage = new LoginPage(appPage);
    await loginPage.login('admin@localhost', 'password');

    // Verify redirect to /library
    await expect(appPage).toHaveURL(/\/library/);

    // Verify library content or user indicator is visible
    // Check for heading with "Alex" or library navigation
    const heading = appPage.getByRole('heading', { name: /alex|library/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show error with invalid credentials', async ({ appPage }) => {
    // Navigate to login page
    await appPage.goto('/login');

    // Create login page object and attempt login with invalid credentials
    const loginPage = new LoginPage(appPage);
    await loginPage.login('wrong@example.com', 'wrongpassword');

    // Verify error message appears
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 5000 });

    // Verify user remains on /login page
    await expect(appPage).toHaveURL(/\/login/);
  });

  authTest('should logout successfully', async ({ authenticatedPage }) => {
    // Navigate to settings page
    await authenticatedPage.goto('/admin/general');

    // Click logout button (skip on desktop mode where button is hidden)
    const logoutButton = authenticatedPage.getByRole('button', { name: /log out/i });
    const isVisible = await logoutButton.isVisible().catch(() => false);

    if (!isVisible) {
      authTest.skip(process.env.E2E_PLATFORM === 'electron', 'Desktop mode has no logout button');
    }

    await logoutButton.click();

    // Verify redirect to /login
    await expect(authenticatedPage).toHaveURL(/\/login/, { timeout: 10000 });

    // Verify attempting to access /library redirects back to /login
    await authenticatedPage.goto('/library');
    await expect(authenticatedPage).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should persist session after page reload', async ({ appPage }) => {
    // Navigate to login page and login
    await appPage.goto('/login');
    const loginPage = new LoginPage(appPage);
    await loginPage.login('admin@localhost', 'password');

    // Verify redirect to /library
    await expect(appPage).toHaveURL(/\/library/);

    // Perform hard refresh
    await appPage.reload();

    // Verify still on /library without redirect to /login
    await expect(appPage).toHaveURL(/\/library/);

    // Verify user menu/session indicator still shows logged-in state
    const heading = appPage.getByRole('heading', { name: /alex|library/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('should bypass login in Electron desktop mode', async ({ appPage }) => {
    // Skip this test if not running in Electron
    test.skip(process.env.E2E_PLATFORM !== 'electron', 'Only applicable in Electron mode');

    // Navigate to /login
    await appPage.goto('/login');

    // Verify immediate redirect to /library without login form interaction
    await expect(appPage).toHaveURL(/\/library/, { timeout: 10000 });

    // Verify authenticated state by checking for library content
    const heading = appPage.getByRole('heading', { name: /alex|library/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });
});
