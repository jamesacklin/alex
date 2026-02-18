import { defineConfig, devices } from '@playwright/test';

const isElectron = process.env.E2E_PLATFORM === 'electron';
const webServerCommand = process.platform === 'win32'
  ? 'pnpm exec next dev --webpack -p 3000 -H 127.0.0.1'
  : 'sh -c "lsof -ti:3000 | xargs kill -9 2>/dev/null || true; pnpm exec next dev --webpack -p 3000 -H 127.0.0.1"';

export default defineConfig({
  testDir: './specs',
  timeout: isElectron ? 120_000 : 60_000, // Electron needs more time for server startup
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Serial execution for SQLite (single-writer)
  use: {
    baseURL: isElectron ? 'http://localhost:3210' : 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: isElectron
    ? [{ name: 'electron', testDir: './specs' }]
    : [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: isElectron
    ? undefined // Electron spawns its own Next.js server
    : {
        command: webServerCommand,
        url: 'http://127.0.0.1:3000/login',
        timeout: 180_000,
        reuseExistingServer: false,
      },
  globalSetup: './global-setup.ts',
});
