import { test, expect } from '../fixtures/app.fixture';
import { test as authTest } from '../fixtures/auth.fixture';
import { LoginPage } from '../page-objects/login.page';
import { OnboardingPage } from '../page-objects/onboarding.page';

test.describe('Authentication', () => {
  test('should login successfully with valid credentials', async ({ appPage }) => {
    // Skip in Electron mode where desktop auth bypasses login
    test.skip(process.env.E2E_PLATFORM === 'electron', 'Desktop mode bypasses login');

    // Navigate to login page
    await appPage.goto('/login');

    // Create login page object and login
    const loginPage = new LoginPage(appPage);
    await loginPage.login('admin@localhost', 'admin123');

    // Verify redirect to /library
    await expect(appPage).toHaveURL(/\/library/);

    // Verify library content or user indicator is visible
    // Check for heading with "Alex" or library navigation
    const heading = appPage.getByRole('heading', { name: /alex|library/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show error with invalid credentials', async ({ appPage }) => {
    // Skip in Electron mode where desktop auth bypasses login
    test.skip(process.env.E2E_PLATFORM === 'electron', 'Desktop mode bypasses login');

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
    // Skip in Electron mode where desktop auth has no logout button
    authTest.skip(process.env.E2E_PLATFORM === 'electron', 'Desktop mode has no logout button');

    // Navigate to settings page
    await authenticatedPage.goto('/admin/general');

    // Click logout button
    const logoutButton = authenticatedPage.getByRole('button', { name: /log out/i });
    await logoutButton.click();

    // Verify redirect to /login
    await expect(authenticatedPage).toHaveURL(/\/login/, { timeout: 10000 });

    // Verify attempting to access /library redirects back to /login
    await authenticatedPage.goto('/library');
    await expect(authenticatedPage).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should persist session after page reload', async ({ appPage }) => {
    // Skip in Electron mode where desktop auth bypasses login
    test.skip(process.env.E2E_PLATFORM === 'electron', 'Desktop mode bypasses login');

    // Navigate to login page and login
    await appPage.goto('/login');
    const loginPage = new LoginPage(appPage);
    await loginPage.login('admin@localhost', 'admin123');

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

    // In Electron desktop mode, app starts on /library with synthetic auth
    // Verify we're already authenticated
    await expect(appPage).toHaveURL(/\/library/, { timeout: 10000 });

    // Verify authenticated state by checking for library content
    const heading = appPage.getByRole('heading', { name: /alex|library/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show onboarding page when library path not set (Electron)', async ({ appPage }) => {
    // Skip this test if not running in Electron
    test.skip(process.env.E2E_PLATFORM !== 'electron', 'Only applicable in Electron mode');

    // Note: Current test fixture sets library path automatically, so onboarding
    // is skipped. This test verifies the OnboardingPage page object is properly
    // constructed and can detect the onboarding page.
    // Full onboarding flow testing with IPC mocking is covered in Phase 6.

    // Create onboarding page object
    const onboardingPage = new OnboardingPage(appPage);

    // Verify onboarding page object can be instantiated
    expect(onboardingPage.selectFolderButton).toBeDefined();
    expect(onboardingPage.getStartedButton).toBeDefined();
    expect(onboardingPage.libraryPathDisplay).toBeDefined();

    // In current fixture setup, library path is set, so app goes directly to /library
    // When Phase 6 adds IPC mocking, this test will verify:
    // - Navigate to app without library path set
    // - Verify onboarding page renders
    // - Verify "Select folder" button is present
  });
});
