import { defineConfig, devices } from '@playwright/test';

const isElectron = process.env.E2E_PLATFORM === 'electron';
const electronBaseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3210';
// In CI the Next.js build runs as a separate workflow step before tests,
// so the webServer command only needs to start the server.  Locally we
// still build first to keep `pnpm e2e` a single-command experience.
const webServerCommand = process.env.CI
  ? (process.platform === 'win32'
      ? 'set PORT=3000&& set HOSTNAME=127.0.0.1&& pnpm start'
      : 'sh -c "lsof -ti:3000 | xargs kill -9 2>/dev/null || true; PORT=3000 HOSTNAME=127.0.0.1 pnpm start"')
  : (process.platform === 'win32'
      ? 'pnpm build && set PORT=3000&& set HOSTNAME=127.0.0.1&& pnpm start'
      : 'sh -c "lsof -ti:3000 | xargs kill -9 2>/dev/null || true; pnpm build && PORT=3000 HOSTNAME=127.0.0.1 pnpm start"');

export default defineConfig({
  testDir: './specs',
  timeout: isElectron ? 120_000 : 60_000, // Electron needs more time for server startup
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Serial execution for SQLite (single-writer)
  use: {
    baseURL: isElectron ? electronBaseUrl : 'http://localhost:3000',
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
        port: 3000,
        timeout: 600_000,
        reuseExistingServer: false,
      },
  globalSetup: './global-setup.ts',
});
