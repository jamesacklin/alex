import { execSync } from 'child_process';

export default async function globalSetup() {
  console.log('[E2E] Running global setup...');

  // Ensure database is set up before tests run
  // This prevents Electron from having to run slow migrations on startup
  try {
    console.log('[E2E] Running database migration...');
    execSync('pnpm db:push', { stdio: 'inherit' });

    console.log('[E2E] Running database seed...');
    execSync('pnpm db:seed', { stdio: 'inherit' });

    console.log('[E2E] Global setup complete');
  } catch (error) {
    console.error('[E2E] Global setup failed:', error);
    throw error;
  }
}
