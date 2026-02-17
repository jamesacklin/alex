import { test as base, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

type AppFixture = { appPage: Page };

export const test = base.extend<AppFixture>({
  appPage: async ({ page }, use) => {
    if (process.env.E2E_PLATFORM === 'electron') {
      // Electron mode: launch the Electron app with test configuration
      const testUserDataDir = path.join(process.cwd(), '.e2e-user-data');
      const testLibraryPath = path.join(process.cwd(), '.e2e-library');

      // Ensure test directories exist
      fs.mkdirSync(testUserDataDir, { recursive: true });
      fs.mkdirSync(testLibraryPath, { recursive: true });

      // Create Electron store config with library path set
      const configPath = path.join(testUserDataDir, 'config.json');
      const storeConfig = {
        libraryPath: testLibraryPath,
        nextauthSecret: crypto.randomBytes(32).toString('hex'),
      };
      fs.writeFileSync(configPath, JSON.stringify(storeConfig, null, 2), 'utf8');

      const app = await electron.launch({
        args: ['electron/dist/main.js'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          ELECTRON_USER_DATA: testUserDataDir,
          DATABASE_PATH: path.join(process.cwd(), 'data/library.db'),
          LIBRARY_PATH: testLibraryPath,
        },
        timeout: 60000, // Give more time for Next.js server to start
      });

      const window = await app.firstWindow({ timeout: 60000 });
      await use(window);
      await app.close();

      // Clean up test directories
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
      fs.rmSync(testLibraryPath, { recursive: true, force: true });
    } else {
      // Web mode: use standard browser page
      await page.goto(process.env.BASE_URL ?? 'http://localhost:3000');
      await use(page);
    }
  },
});

export { expect } from '@playwright/test';
