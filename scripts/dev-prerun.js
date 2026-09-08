const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = process.cwd();
const dataDir = path.join(root, 'data');

const wipeDirs = [
  path.join(dataDir, 'library'),
  path.join(dataDir, 'auth'),
  path.join(dataDir, 'covers'),
];

const wipeFiles = [
  path.join(dataDir, 'library.db'),
  path.join(dataDir, 'library.db-shm'),
  path.join(dataDir, 'library.db-wal'),
  // Drop the one-time setup token too, so a wiped database gets a fresh one
  // rather than reusing the token minted for the previous database.
  path.join(dataDir, 'setup-token'),
];

for (const dir of wipeDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

for (const file of wipeFiles) {
  fs.rmSync(file, { force: true });
}

execSync('pnpm db:push', { stdio: 'inherit' });

// Provision a development account only when one is explicitly configured.
// There is no default credential to fall back on: a published default was
// finding F01 of the September 2026 adversarial review.
if (process.env.ALEX_ADMIN_EMAIL && process.env.ALEX_ADMIN_PASSWORD) {
  execSync('pnpm db:seed', { stdio: 'inherit' });
  console.log('[dev:prerun] Wiped library/auth/db state and provisioned the configured account.');
} else {
  console.log('[dev:prerun] Wiped library/auth/db state.');
  console.log('[dev:prerun] No account exists. Open /setup and use the one-time token');
  console.log('[dev:prerun] the server prints, or set these before starting to skip that:');
  console.log('[dev:prerun]');
  console.log("[dev:prerun]   export ALEX_ADMIN_EMAIL=dev@localhost");
  console.log("[dev:prerun]   export ALEX_ADMIN_PASSWORD='a password you choose'");
  console.log('[dev:prerun]');
}
