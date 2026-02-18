import { test, expect } from '../fixtures/app.fixture';
import type { ElectronApplication } from 'playwright';
import type { Page } from '@playwright/test';

function ensureElectronApp(
  electronApp: ElectronApplication | null,
): asserts electronApp is ElectronApplication {
  if (!electronApp) {
    throw new Error('electronApp fixture is required for desktop tests');
  }
}

function appUrl(page: Page, path: string): string {
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') {
    return `http://localhost:3210${path}`;
  }

  try {
    const parsed = new URL(currentUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin + path;
    }
  } catch {
    return `http://localhost:3210${path}`;
  }

  return `http://localhost:3210${path}`;
}

test('electron creates a system tray icon (US-009)', async ({ electronApp }) => {
  test.skip(process.env.E2E_PLATFORM !== 'electron', 'Electron-only desktop behavior');
  ensureElectronApp(electronApp);

  await expect.poll(
    async () => electronApp.evaluate(() => {
      const trayState = (globalThis as Record<string, unknown>).__ALEX_E2E_TRAY__;
      if (!trayState || typeof trayState !== 'object') return false;
      return Boolean((trayState as { exists?: boolean }).exists);
    }),
    { timeout: 20000 },
  ).toBe(true);
});

test('electron tray menu includes expected actions (US-010)', async ({ electronApp }) => {
  test.skip(process.env.E2E_PLATFORM !== 'electron', 'Electron-only desktop behavior');
  ensureElectronApp(electronApp);

  let trayState: { exists: boolean; menuLabels: string[] } = {
    exists: false,
    menuLabels: [],
  };
  await expect.poll(
    async () => {
      trayState = await electronApp.evaluate(() => {
        const trayState = (globalThis as Record<string, unknown>).__ALEX_E2E_TRAY__;
        if (!trayState || typeof trayState !== 'object') {
          return { exists: false, menuLabels: [] as string[] };
        }

        const exists = Boolean((trayState as { exists?: boolean }).exists);
        const menuLabels = (trayState as { menuLabels?: unknown }).menuLabels;
        if (!Array.isArray(menuLabels)) {
          return { exists, menuLabels: [] as string[] };
        }

        return {
          exists,
          menuLabels: menuLabels.filter((value): value is string => typeof value === 'string'),
        };
      });
      return trayState.exists ? trayState.menuLabels.length : 0;
    },
    { timeout: 20000 },
  ).toBeGreaterThan(0);

  expect(trayState.exists).toBe(true);
  expect(trayState.menuLabels).toEqual(expect.arrayContaining([
    'Show Alex',
    'Quit Alex',
  ]));
  expect(trayState.menuLabels.some((label) => label.startsWith('Change Library Folder'))).toBe(true);
});

test('electron can change library path via mocked IPC (US-011)', async ({ appPage, electronApp }) => {
  test.skip(process.env.E2E_PLATFORM !== 'electron', 'Electron-only desktop behavior');
  ensureElectronApp(electronApp);

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('select-library-path');
    ipcMain.handle('select-library-path', async () => '/mock/path');
    ipcMain.removeHandler('get-library-path');
    ipcMain.handle('get-library-path', async () => '/mock/path');
  });

  await appPage.goto(appUrl(appPage, '/admin/library'));
  await appPage.getByRole('button', { name: /change directory/i }).click();

  await expect(appPage.getByText(/library directory changed/i)).toBeVisible({ timeout: 10000 });
  await expect(appPage.getByText('/mock/path')).toBeVisible({ timeout: 10000 });
});

test('electron rescan action triggers watcher restart IPC (US-012)', async ({ appPage, electronApp }) => {
  test.skip(process.env.E2E_PLATFORM !== 'electron', 'Electron-only desktop behavior');
  ensureElectronApp(electronApp);

  await electronApp.evaluate(({ ipcMain }) => {
    const globalState = globalThis as Record<string, unknown>;
    globalState.__ALEX_E2E_RESCAN_COUNT__ = 0;

    ipcMain.removeHandler('rescan-library');
    ipcMain.handle('rescan-library', () => {
      const currentCount = globalState.__ALEX_E2E_RESCAN_COUNT__;
      const nextCount = typeof currentCount === 'number' ? currentCount + 1 : 1;
      globalState.__ALEX_E2E_RESCAN_COUNT__ = nextCount;
      return true;
    });
  });

  await appPage.goto(appUrl(appPage, '/admin/library'));
  await appPage.getByRole('button', { name: /restart watcher|rescan library/i }).click();

  await expect(appPage.getByText(/library rescan started/i)).toBeVisible({ timeout: 10000 });
  await expect.poll(
    async () => electronApp.evaluate(() => {
      const currentCount = (globalThis as Record<string, unknown>).__ALEX_E2E_RESCAN_COUNT__;
      return typeof currentCount === 'number' ? currentCount : 0;
    }),
    { timeout: 10000 },
  ).toBe(1);
});

test('electron close action hides window and keeps app running (US-013)', async ({ electronApp }) => {
  test.skip(process.env.E2E_PLATFORM !== 'electron', 'Electron-only desktop behavior');
  ensureElectronApp(electronApp);

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });

  let windowState: { isReady: boolean; windowCount: number; isVisible: boolean } = {
    isReady: false,
    windowCount: 0,
    isVisible: true,
  };

  await expect.poll(
    async () => {
      windowState = await electronApp.evaluate(({ app, BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        return {
          isReady: app.isReady(),
          windowCount: windows.length,
          isVisible: windows[0]?.isVisible() ?? false,
        };
      });
      const hiddenToTray = windowState.windowCount === 0 || !windowState.isVisible;
      return windowState.isReady && hiddenToTray;
    },
    { timeout: 15000 },
  ).toBe(true);

  expect(windowState.isReady).toBe(true);
});

test('electron onboarding flow completes with mocked IPC (US-014)', async ({ appPage, electronApp }) => {
  test.skip(process.env.E2E_PLATFORM !== 'electron', 'Electron-only desktop behavior');
  ensureElectronApp(electronApp);

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('get-library-path');
    ipcMain.handle('get-library-path', async () => '');
    ipcMain.removeHandler('select-library-path-initial');
    ipcMain.handle('select-library-path-initial', async () => '/mock/library');
    ipcMain.removeHandler('complete-onboarding');
    ipcMain.handle('complete-onboarding', async () => ({ success: true }));
  });

  await appPage.goto(appUrl(appPage, '/onboarding'));
  await expect(appPage).toHaveURL(/\/onboarding/, { timeout: 10000 });
  await expect(appPage.getByRole('button', { name: /select folder/i })).toBeVisible({ timeout: 10000 });

  await appPage.getByRole('button', { name: /select folder/i }).click();
  await expect(appPage.getByText('/mock/library')).toBeVisible({ timeout: 10000 });

  await appPage.getByRole('button', { name: /get started/i }).click();
  await expect(appPage).toHaveURL(/\/library/, { timeout: 10000 });
});
