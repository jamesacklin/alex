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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRouteReady(url: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(requestTimeout);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for ${url}. Last error: ${String(lastError)}`);
}

async function waitForElectronWindow(electronApp: ElectronApplication, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const windowCount = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    if (windowCount > 0) {
      return;
    }

    const electronProcess = electronApp.process();
    if (electronProcess.exitCode !== null) {
      throw new Error(`Electron process exited before creating a window (exit code ${electronProcess.exitCode})`);
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for Electron window creation`);
}

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

    // CI runners (Linux) lack the SUID sandbox binary; disable it there.
    const launchArgs = [electronEntry, `--user-data-dir=${testUserDataDir}`];
    if (process.env.CI) {
      launchArgs.push('--no-sandbox');
    }

    const app = await electron.launch({
      args: launchArgs,
      env: {
        ...process.env,
        ALEX_E2E: 'true',
        DATABASE_PATH: path.join(process.cwd(), 'data/library.db'),
        LIBRARY_PATH: testLibraryPath,
      },
      timeout: 60000,
    });

    const electronProcess = app.process();
    const logElectronProcess = process.env.E2E_DEBUG_ELECTRON === '1';
    const onStdout = (chunk: Buffer) => process.stdout.write(`[Electron stdout] ${chunk.toString()}`);
    const onStderr = (chunk: Buffer) => process.stderr.write(`[Electron stderr] ${chunk.toString()}`);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      console.log(`[Fixture] Electron process exited (code=${code}, signal=${signal})`);
    };

    if (logElectronProcess) {
      electronProcess.stdout?.on('data', onStdout);
      electronProcess.stderr?.on('data', onStderr);
    }
    electronProcess.on('exit', onExit);

    try {
      await use(app);
    } finally {
      if (logElectronProcess) {
        electronProcess.stdout?.off('data', onStdout);
        electronProcess.stderr?.off('data', onStderr);
      }
      electronProcess.off('exit', onExit);

      console.log('[Fixture] Closing Electron app...');
      try {
        await app.close();
      } catch (error) {
        console.warn('[Fixture] Electron app was already closed:', error);
      }

      fs.rmSync(testUserDataDir, { recursive: true, force: true });
      fs.rmSync(testLibraryPath, { recursive: true, force: true });
    }
  },

  appPage: async ({ page, electronApp }, use) => {
    if (process.env.E2E_PLATFORM === 'electron') {
      if (!electronApp) {
        throw new Error('electronApp fixture was not initialized');
      }

      const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3210';
      // The default Playwright page is a separate Chromium client and can race
      // the real Electron window; close it in desktop mode.
      try {
        await page.close();
      } catch {
        // Ignore if already closed.
      }

      console.log('[Fixture] Waiting for Electron BrowserWindow...');
      await waitForElectronWindow(electronApp);
      const electronPage = await electronApp.firstWindow();
      await electronPage.bringToFront();
      console.log('[Fixture] Electron window found, waiting for route readiness...');
      await waitForRouteReady(`${baseUrl}/login`);
      console.log('[Fixture] Route ready, navigating appPage to stable desktop route...');
      await electronPage.goto(`${baseUrl}/library`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await electronPage.waitForURL(
        (url) => url.pathname === '/library' || url.pathname === '/onboarding',
        { timeout: 30000 },
      );
      await use(electronPage);
      return;
    }

    await page.goto((process.env.BASE_URL ?? 'http://localhost:3000') + '/login', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
