import { test, expect } from '../fixtures/app.fixture';
import type { ElectronApplication } from 'playwright';

function ensureElectronApp(
  electronApp: ElectronApplication | null,
): asserts electronApp is ElectronApplication {
  if (!electronApp) {
    throw new Error('electronApp fixture is required for desktop tests');
  }
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
