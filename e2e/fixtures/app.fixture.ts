import { test as base, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';

type AppFixture = { appPage: Page };

export const test = base.extend<AppFixture>({
  appPage: async ({ page }, use) => {
    if (process.env.E2E_PLATFORM === 'electron') {
      // Electron mode: launch the Electron app
      const app = await electron.launch({
        args: ['electron/dist/main.js'],
        env: { ...process.env, NODE_ENV: 'test' },
      });
      const window = await app.firstWindow();
      await use(window);
      await app.close();
    } else {
      // Web mode: use standard browser page
      await page.goto(process.env.BASE_URL ?? 'http://localhost:3000');
      await use(page);
    }
  },
});

export { expect } from '@playwright/test';
