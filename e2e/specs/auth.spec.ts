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
});
