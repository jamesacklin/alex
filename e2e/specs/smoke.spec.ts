import { test, expect } from '../fixtures/app.fixture';

test('app loads and displays title', async ({ appPage }) => {
  await expect(appPage).toHaveTitle(/Alex/);
});
