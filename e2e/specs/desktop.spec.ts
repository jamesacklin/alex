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
