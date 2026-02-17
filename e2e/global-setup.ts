import { execSync } from 'child_process';
import { resetDatabase, seedDatabase } from './helpers/db';

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

    // Ensure database is set up before tests run
    // This prevents Electron from having to run slow migrations on startup
    console.log('[E2E] Running database migration...');
    execSync('pnpm db:push', { stdio: 'inherit' });

    // Reset and seed test database
    console.log('[E2E] Resetting database...');
    await resetDatabase();

    console.log('[E2E] Seeding database...');
    await seedDatabase();
    console.log('[E2E] Database reset and seeded');

    console.log('[E2E] Global setup complete');
  } catch (error) {
    console.error('[E2E] Global setup failed:', error);
    throw error;
  }
}
