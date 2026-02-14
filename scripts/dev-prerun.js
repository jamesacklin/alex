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
];

for (const dir of wipeDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

for (const file of wipeFiles) {
  fs.rmSync(file, { force: true });
}

execSync('pnpm db:push', { stdio: 'inherit' });
execSync('pnpm db:seed', { stdio: 'inherit' });

console.log('[dev:prerun] Wiped library/auth/db state and reseeded admin user.');
