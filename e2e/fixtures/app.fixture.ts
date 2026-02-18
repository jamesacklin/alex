/* eslint-disable react-hooks/rules-of-hooks */
// Playwright's fixture `use()` function is not a React hook
import { test as base, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

type AppFixture = {
  appPage: Page;
  electronApp: ElectronApplication | null;
};

export const test = base.extend<AppFixture>({
  electronApp: async ({ context }, use) => {
    void context;

    if (process.env.E2E_PLATFORM !== 'electron') {
      await use(null);
      return;
    }

    const testUserDataDir = path.join(process.cwd(), '.e2e-user-data');
    const testLibraryPath = path.join(process.cwd(), '.e2e-library');

    console.log('[Fixture] Setting up Electron test environment');
    console.log('[Fixture] User data dir:', testUserDataDir);
    console.log('[Fixture] Library path:', testLibraryPath);

    const electronEntry = path.join(process.cwd(), 'electron', 'dist', 'main.js');
    if (!fs.existsSync(electronEntry)) {
      console.log('[Fixture] Electron dist missing, compiling main process...');
      execSync('pnpm electron:compile', { stdio: 'inherit' });
    }

    fs.mkdirSync(testUserDataDir, { recursive: true });
    fs.mkdirSync(testLibraryPath, { recursive: true });

    const configPath = path.join(testUserDataDir, 'config.json');
    const storeConfig = {
      libraryPath: testLibraryPath,
      nextauthSecret: crypto.randomBytes(32).toString('hex'),
    };
    fs.writeFileSync(configPath, JSON.stringify(storeConfig, null, 2), 'utf8');
    console.log('[Fixture] Created Electron store config');

    const app = await electron.launch({
      args: [electronEntry, `--user-data-dir=${testUserDataDir}`],
      env: {
        ...process.env,
        ALEX_E2E: 'true',
        DATABASE_PATH: path.join(process.cwd(), 'data/library.db'),
        LIBRARY_PATH: testLibraryPath,
      },
      timeout: 60000,
    });

    await use(app);

    console.log('[Fixture] Closing Electron app...');
    await app.close();

    fs.rmSync(testUserDataDir, { recursive: true, force: true });
    fs.rmSync(testLibraryPath, { recursive: true, force: true });
  },

  appPage: async ({ page, electronApp }, use) => {
    if (process.env.E2E_PLATFORM === 'electron') {
      if (!electronApp) {
        throw new Error('electronApp fixture was not initialized');
      }

      const existingAppWindow = electronApp.windows().find((window) => !window.url().startsWith('devtools://'));
      let appWindow = existingAppWindow;

      if (!appWindow) {
        const firstWindow = await electronApp.firstWindow({ timeout: 120000 });
        appWindow = firstWindow;

        if (firstWindow.url().startsWith('devtools://')) {
          appWindow = await electronApp.waitForEvent('window', {
            predicate: (window) => !window.url().startsWith('devtools://'),
            timeout: 120000,
          });
        }
      }

      await appWindow.waitForLoadState('domcontentloaded', { timeout: 120000 });
      await use(appWindow);
      return;
    }

    await use(page);
  },
});

export { expect } from '@playwright/test';
