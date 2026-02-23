const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MIGRATION_BREAKPOINT = '--> statement-breakpoint';

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

function runWatcherDb(binaryPath, dbPath, action, sql, params = []) {
  const result = spawnSync(binaryPath, ['db', '--db-path', dbPath, action], {
    cwd: process.cwd(),
    env: process.env,
    input: JSON.stringify({ sql, params }),
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `[db:push] watcher-rs failed (${result.status})\n${result.stderr?.trim() || '(no stderr)'}`
    );
  }

  const payload = result.stdout?.trim();
  if (!payload) {
    return {};
  }

  return JSON.parse(payload);
}

function splitMigrationStatements(sql) {
  return sql
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function main() {
  const dbPath = path.resolve(process.env.DATABASE_PATH || './data/library.db');
  const migrationPath = path.resolve(
    process.env.DB_MIGRATION_PATH || './src/lib/db/migrations/0000_wide_expediter.sql'
  );

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`[db:push] Migration file not found: ${migrationPath}`);
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const binaryPath = resolveWatcherBinary();

  const usersTable = runWatcherDb(
    binaryPath,
    dbPath,
    'query-one',
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1",
  ).row;

  if (!usersTable) {
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const statements = splitMigrationStatements(migrationSql);
    for (const statement of statements) {
      runWatcherDb(binaryPath, dbPath, 'execute', statement);
    }
    console.log('[db:push] Applied initial schema migration.');
  } else {
    console.log('[db:push] Schema already present.');
  }

  const hasHashIndex = runWatcherDb(
    binaryPath,
    dbPath,
    'query-one',
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = 'books_file_hash_unique' LIMIT 1",
  ).row;

  if (!hasHashIndex) {
    console.log('[db:push] Missing unique book indexes, applying dedupe + index fix...');
    runWatcherDb(
      binaryPath,
      dbPath,
      'execute',
      `
        DELETE FROM books WHERE id IN (
          SELECT b.id FROM books b
          INNER JOIN (
            SELECT file_hash, MIN(added_at) AS min_added
            FROM books GROUP BY file_hash HAVING COUNT(*) > 1
          ) d ON b.file_hash = d.file_hash AND b.added_at > d.min_added
        )
      `,
    );
    runWatcherDb(
      binaryPath,
      dbPath,
      'execute',
      `
        DELETE FROM books WHERE id IN (
          SELECT b.id FROM books b
          INNER JOIN (
            SELECT file_path, MIN(added_at) AS min_added
            FROM books GROUP BY file_path HAVING COUNT(*) > 1
          ) d ON b.file_path = d.file_path AND b.added_at > d.min_added
        )
      `,
    );
    runWatcherDb(
      binaryPath,
      dbPath,
      'execute',
      'CREATE UNIQUE INDEX IF NOT EXISTS `books_file_path_unique` ON `books` (`file_path`)',
    );
    runWatcherDb(
      binaryPath,
      dbPath,
      'execute',
      'CREATE UNIQUE INDEX IF NOT EXISTS `books_file_hash_unique` ON `books` (`file_hash`)',
    );
  }

  // --- S3 source columns migration (0001) ---
  const hasSourceColumn = runWatcherDb(
    binaryPath,
    dbPath,
    'query-one',
    "SELECT 1 AS present FROM pragma_table_info('books') WHERE name = 'source' LIMIT 1",
  ).row;

  if (!hasSourceColumn) {
    console.log('[db:push] Applying S3 source columns migration...');
    const s3MigrationPath = path.resolve(
      path.dirname(migrationPath),
      '0001_s3_source_columns.sql',
    );

    if (fs.existsSync(s3MigrationPath)) {
      const s3Sql = fs.readFileSync(s3MigrationPath, 'utf8');
      const s3Statements = splitMigrationStatements(s3Sql);
      for (const statement of s3Statements) {
        try {
          runWatcherDb(binaryPath, dbPath, 'execute', statement);
        } catch (e) {
          // Column may already exist if partially applied
          if (!String(e).includes('duplicate column')) {
            throw e;
          }
        }
      }
      console.log('[db:push] S3 source columns applied.');
    } else {
      console.log('[db:push] S3 migration file not found, skipping.');
    }
  }

  console.log('[db:push] Database schema is ready.');
}

main();
