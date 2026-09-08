// Apply schema migrations.
//
// The migration set, its ordering and the applied-version ledger all live in
// watcher-rs (`db migrate`), which embeds the SQL files at compile time.
// This script only resolves the binary and reports the result, so there is no
// second copy of the migration logic to drift.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function watcherBinaryName() {
  return process.platform === 'win32' ? 'watcher-rs.exe' : 'watcher-rs';
}

function resolveWatcherBinary() {
  const envBinary = process.env.WATCHER_RS_BIN;
  const packagedBinary = path.join(process.cwd(), 'watcher-rs', watcherBinaryName());
  const releaseBinary = path.join(process.cwd(), 'watcher-rs', 'target', 'release', watcherBinaryName());
  const distBinary = path.join(process.cwd(), 'watcher-rs', 'dist', watcherBinaryName());

  const candidates = [envBinary, packagedBinary, releaseBinary, distBinary].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  console.log('[db:push] watcher-rs binary not found, building release binary...');
  const build = spawnSync(
    'cargo',
    ['build', '--manifest-path', path.join(process.cwd(), 'watcher-rs', 'Cargo.toml'), '--release', '--locked'],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (build.error) {
    throw build.error;
  }
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  if (fs.existsSync(releaseBinary)) {
    return releaseBinary;
  }

  throw new Error(`[db:push] Unable to resolve watcher-rs binary. Checked: ${candidates.join(', ')}`);
}

function main() {
  const dbPath = path.resolve(process.env.DATABASE_PATH || './data/library.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const binaryPath = resolveWatcherBinary();
  const result = spawnSync(binaryPath, ['db', '--db-path', dbPath, 'migrate'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error(result.stderr?.trim() || '(no stderr)');
    throw new Error(`[db:push] Migration failed (exit code ${result.status})`);
  }

  const payload = result.stdout?.trim();
  const parsed = payload ? JSON.parse(payload) : { applied: [], version: null };

  if (parsed.applied.length === 0) {
    console.log(`[db:push] Schema already at version ${parsed.version}.`);
  } else {
    for (const migration of parsed.applied) {
      console.log(`[db:push] Applied ${String(migration.version).padStart(4, '0')}_${migration.name}`);
    }
    console.log(`[db:push] Database schema is ready (version ${parsed.version}).`);
  }
}

main();
