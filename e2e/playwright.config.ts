import { defineConfig, devices } from '@playwright/test';

const isElectron = process.env.E2E_PLATFORM === 'electron';

export default defineConfig({
  testDir: './specs',
  timeout: isElectron ? 120_000 : 60_000, // Electron needs more time for server startup
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Serial execution for SQLite (single-writer)
  use: {
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
        command: 'pnpm dev',
        port: 3000,
        reuseExistingServer: !process.env.CI,
      },
  globalSetup: './global-setup.ts',
});
