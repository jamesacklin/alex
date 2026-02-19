import { execSync } from 'child_process';
import { resetDatabase, seedDatabase } from './helpers/db';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebRouteReady(url: string, timeoutMs = 300_000) {
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

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${url} to become ready. Last error: ${String(lastError)}`);
}

export default async function globalSetup() {
  console.log('[E2E] Running global setup...');

  try {
    // Kill any existing processes on port 3210 (Electron's port)
    // This prevents EADDRINUSE errors when running tests
    console.log('[E2E] Cleaning up any existing processes on port 3210...');
    try {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        execSync('lsof -ti:3210 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
      } else if (process.platform === 'win32') {
        execSync('FOR /F "tokens=5" %P IN (\'netstat -a -n -o ^| findstr :3210\') DO TaskKill.exe /F /PID %P 2>nul || exit 0', { stdio: 'ignore' });
      }
    } catch {
      // Ignore errors - port might not be in use
    }

    // Ensure database is set up before tests run.
    // In CI, the workflow already ran db:push, build, and electron:compile,
    // so skip those steps to avoid redundant (and slow) work.
    if (!process.env.CI) {
      console.log('[E2E] Running database migration...');
      execSync('pnpm db:push', { stdio: 'inherit' });

      if (process.env.E2E_PLATFORM === 'electron') {
        console.log('[E2E] Building Next.js app for Electron e2e runtime...');
        execSync('pnpm build', { stdio: 'inherit' });
        console.log('[E2E] Compiling Electron main process...');
        execSync('pnpm electron:compile', { stdio: 'inherit' });
      }
    } else {
      console.log('[E2E] CI detected: skipping build/compile/migrate (handled by workflow)');
    }

    // Reset and seed test database
    console.log('[E2E] Resetting database...');
    await resetDatabase();

    console.log('[E2E] Seeding database...');
    await seedDatabase();
    console.log('[E2E] Database reset and seeded');

    if (process.env.E2E_PLATFORM === 'web') {
      console.log('[E2E] Warming up /login route for web tests...');
      await waitForWebRouteReady('http://127.0.0.1:3000/login');
      console.log('[E2E] /login route is ready');
    }

    console.log('[E2E] Global setup complete');
  } catch (error) {
    console.error('[E2E] Global setup failed:', error);
    throw error;
  }
}
