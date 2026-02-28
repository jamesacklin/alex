import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { spawn, ChildProcess, spawnSync } from 'child_process';
import { store } from './store';
import { getDataPaths } from './paths';
import { createTray, destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let watcherProcess: ChildProcess | null = null;
let isQuitting = false;
let isFirstRun = false;

const PORT = 3210;
const isDev = !app.isPackaged;
const isE2E = process.env.ALEX_E2E === 'true';
const detachChildProcesses = process.platform !== 'win32' && !isDev;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPackagedNodeCommand(): string {
  const helperName = `${app.getName()} Helper`;
  const helperPath = path.join(
    process.resourcesPath,
    '..',
    'Frameworks',
    `${helperName}.app`,
    'Contents',
    'MacOS',
    helperName,
  );

  if (fs.existsSync(helperPath)) {
    return helperPath;
  }

  return process.execPath;
}

function resolveMigrationPath() {
  const migrationRelPath = path.join('src', 'lib', 'db', 'migrations', '0000_wide_expediter.sql');
  const candidates = [
    path.join(process.cwd(), migrationRelPath),
    path.join(app.getAppPath(), migrationRelPath),
    path.join(process.resourcesPath, migrationRelPath),
    path.join(process.resourcesPath, 'app', migrationRelPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isS3Configured() {
  const mode = store.get('storageMode') || 'local';
  const config = store.get('s3Config');
  return mode === 's3' && !!(config?.bucket && config?.accessKey && config?.secretKey);
}

function shouldStartWatcher(libraryPath: string) {
  return Boolean(libraryPath) || isS3Configured();
}

function getEnvVars(libraryPath: string) {
  const paths = getDataPaths(libraryPath);
  const nextauthSecret = store.get('nextauthSecret');
  const nodeEnv = isE2E
    ? 'production'
    : process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'production' ||
        process.env.NODE_ENV === 'test'
      ? process.env.NODE_ENV
      : isDev
        ? 'development'
        : 'production';

  // Build optional S3 env vars
  const s3Vars: Record<string, string> = {};
  const storageMode = store.get('storageMode');
  const s3Config = store.get('s3Config');
  if (storageMode === 's3' && s3Config) {
    s3Vars.S3_BUCKET = s3Config.bucket;
    s3Vars.S3_ACCESS_KEY_ID = s3Config.accessKey;
    s3Vars.S3_SECRET_ACCESS_KEY = s3Config.secretKey;
    if (s3Config.endpoint) s3Vars.S3_ENDPOINT = s3Config.endpoint;
    if (s3Config.region) s3Vars.S3_REGION = s3Config.region;
    if (s3Config.prefix) s3Vars.S3_PREFIX = s3Config.prefix;
    if (s3Config.pollInterval) s3Vars.S3_POLL_INTERVAL = String(s3Config.pollInterval);
  }

  return {
    ...process.env,
    ...s3Vars,
    NODE_ENV: nodeEnv,
    DATABASE_PATH: paths.databasePath,
    LIBRARY_PATH: paths.libraryPath,
    COVERS_PATH: paths.coversPath,
    PORT: PORT.toString(),
    ALEX_DESKTOP: 'true',
    NEXTAUTH_SECRET: nextauthSecret,
    NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
  };
}

type WatcherDbAction = 'query-all' | 'query-one' | 'execute';
let cachedDevWatcherDbBinary: string | null = null;

function resolveDevWatcherDbBinary(): string {
  if (cachedDevWatcherDbBinary && fs.existsSync(cachedDevWatcherDbBinary)) {
    return cachedDevWatcherDbBinary;
  }

  const envBinary = process.env.WATCHER_RS_BIN;
  const releaseBinary = getDevWatcherBinaryPath();
  const distBinary = path.join(process.cwd(), 'watcher-rs', 'dist', watcherBinaryName());
  const candidates = [envBinary, releaseBinary, distBinary].filter((candidate): candidate is string => !!candidate);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedDevWatcherDbBinary = candidate;
      return candidate;
    }
  }

  console.log('[Electron] watcher-rs binary not found, building release binary for DB setup...');
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
    throw new Error(`[Electron] watcher-rs build failed with code ${build.status}`);
  }

  if (fs.existsSync(releaseBinary)) {
    cachedDevWatcherDbBinary = releaseBinary;
    return releaseBinary;
  }

  throw new Error(`[Electron] Unable to resolve watcher-rs DB binary. Checked: ${candidates.join(', ')}`);
}

function runWatcherDbCommand(
  action: WatcherDbAction,
  request: { sql: string; params?: unknown[] },
  env: NodeJS.ProcessEnv,
) {
  const dbPath = env.DATABASE_PATH;
  if (!dbPath) {
    throw new Error('DATABASE_PATH is not set');
  }

  const input = JSON.stringify({
    sql: request.sql,
    params: request.params ?? [],
  });

  if (!isDev) {
    const packagedBinary = getPackagedWatcherBinaryPath();
    if (!fs.existsSync(packagedBinary)) {
      throw new Error(`Packaged watcher binary not found: ${packagedBinary}`);
    }

    const result = spawnSync(packagedBinary, ['db', '--db-path', dbPath, action], {
      cwd: process.resourcesPath,
      env,
      input,
      encoding: 'utf8',
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || `[watcher-rs] exited with code ${result.status}`);
    }

    const payload = result.stdout?.trim();
    if (!payload) {
      return {};
    }
    return JSON.parse(payload) as { row?: unknown; rows?: unknown[]; changes?: number };
  }

  const devBinary = resolveDevWatcherDbBinary();
  const result = spawnSync(devBinary, ['db', '--db-path', dbPath, action], {
    cwd: process.cwd(),
    env,
    input,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `[watcher-rs] exited with code ${result.status}`);
  }

  const payload = result.stdout?.trim();
  if (!payload) {
    return {};
  }
  return JSON.parse(payload) as { row?: unknown; rows?: unknown[]; changes?: number };
}

function runDbSetup(libraryPath: string) {
  const env = getEnvVars(libraryPath);
  const databasePath = env.DATABASE_PATH;
  if (!databasePath) {
    console.error('[Electron] DATABASE_PATH is not set; skipping database setup');
    return;
  }
  const absoluteDatabasePath = path.resolve(databasePath);
  const migrationPath = resolveMigrationPath();

  try {
    if (!migrationPath) {
      console.error('[Electron] Migration file not found; skipping database setup');
      return;
    }

    fs.mkdirSync(path.dirname(absoluteDatabasePath), { recursive: true });

    const usersTableExists = runWatcherDbCommand(
      'query-one',
      { sql: "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1" },
      env,
    ).row;

    if (!usersTableExists) {
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      const statements = migrationSql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

      for (const statement of statements) {
        runWatcherDbCommand('execute', { sql: statement }, env);
      }
      console.log('[Electron] Database schema initialized');
    }

    const booksTableExists = runWatcherDbCommand(
      'query-one',
      { sql: "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'books' LIMIT 1" },
      env,
    ).row;

    if (booksTableExists) {
      const requiredS3Columns = [
        { name: 'source', definition: "TEXT NOT NULL DEFAULT 'local'" },
        { name: 's3_bucket', definition: 'TEXT' },
        { name: 's3_etag', definition: 'TEXT' },
      ] as const;

      for (const column of requiredS3Columns) {
        const hasColumn = runWatcherDbCommand(
          'query-one',
          {
            sql: "SELECT 1 AS present FROM pragma_table_info('books') WHERE name = ?1 LIMIT 1",
            params: [column.name],
          },
          env,
        ).row;

        if (!hasColumn) {
          runWatcherDbCommand(
            'execute',
            { sql: `ALTER TABLE books ADD COLUMN ${column.name} ${column.definition}` },
            env,
          );
          console.log(`[Electron] Added missing books.${column.name} column`);
        }
      }
    }

    const hasFileHashIndex = runWatcherDbCommand(
      'query-one',
      { sql: "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = 'books_file_hash_unique' LIMIT 1" },
      env,
    ).row;

    if (!hasFileHashIndex) {
      console.log('[Electron] Missing unique indexes on books table, applying fix...');

      runWatcherDbCommand(
        'execute',
        {
          sql: `
            DELETE FROM books WHERE id IN (
              SELECT b.id FROM books b
              INNER JOIN (
                SELECT file_hash, MIN(added_at) AS min_added
                FROM books GROUP BY file_hash HAVING COUNT(*) > 1
              ) d ON b.file_hash = d.file_hash AND b.added_at > d.min_added
            )
          `,
        },
        env,
      );

      runWatcherDbCommand(
        'execute',
        {
          sql: `
            DELETE FROM books WHERE id IN (
              SELECT b.id FROM books b
              INNER JOIN (
                SELECT file_path, MIN(added_at) AS min_added
                FROM books GROUP BY file_path HAVING COUNT(*) > 1
              ) d ON b.file_path = d.file_path AND b.added_at > d.min_added
            )
          `,
        },
        env,
      );

      runWatcherDbCommand(
        'execute',
        { sql: 'CREATE UNIQUE INDEX IF NOT EXISTS `books_file_path_unique` ON `books` (`file_path`)' },
        env,
      );
      runWatcherDbCommand(
        'execute',
        { sql: 'CREATE UNIQUE INDEX IF NOT EXISTS `books_file_hash_unique` ON `books` (`file_hash`)' },
        env,
      );
      console.log('[Electron] Unique indexes created and duplicates cleaned up');
    }

    const adminEmail = 'admin@localhost';
    const existingAdmin = runWatcherDbCommand(
      'query-one',
      {
        sql: 'SELECT 1 AS present FROM users WHERE email = ?1 LIMIT 1',
        params: [adminEmail],
      },
      env,
    ).row;

    if (!existingAdmin) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bcrypt = require('bcryptjs') as { hashSync: (value: string, rounds: number) => string };
      const now = Math.floor(Date.now() / 1000);
      const passwordHash = bcrypt.hashSync('admin123', 10);
      runWatcherDbCommand(
        'execute',
        {
          sql: `
            INSERT INTO users (
              id, email, password_hash, display_name, role, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          `,
          params: ['1', adminEmail, passwordHash, 'Admin', 'admin', now, now],
        },
        env,
      );
      console.log('[Electron] Seeded default admin user');
    }
  } catch (error) {
    console.error('[Electron] Database setup failed:', error);
  }
}

function startServer(libraryPath: string) {
  const env = getEnvVars(libraryPath);
  const runProdLikeServerForE2E = isDev && isE2E;
  const standaloneBasePath = isDev ? process.cwd() : app.getAppPath();
  const standaloneServerPath = path.join(standaloneBasePath, '.next', 'standalone', 'server.js');
  const useStandaloneServerForE2E = runProdLikeServerForE2E && fs.existsSync(standaloneServerPath);
  const packagedBootstrapScript = [
    "const Module=require('node:module')",
    "const path=require('node:path')",
    "const originalResolveFilename=Module._resolveFilename",
    "Module._resolveFilename=function(request,parent,isMain,options){",
    "if(/^canvas-[a-f0-9]{8,}$/i.test(request))request='canvas'",
    'return originalResolveFilename.call(this,request,parent,isMain,options)',
    '}',
    'const chdir=process.chdir.bind(process)',
    "process.chdir=(directory)=>{try{chdir(directory)}catch(error){if(!error||error.code!=='ENOTDIR')throw error}}",
    "require(path.join(process.argv[1],'.next/standalone/server.js'))",
  ].join(';');
  if (runProdLikeServerForE2E && !useStandaloneServerForE2E) {
    console.warn(`[Electron] E2E standalone server not found at ${standaloneServerPath}; falling back to pnpm start`);
  } else if (useStandaloneServerForE2E) {
    console.log(`[Electron] E2E mode: starting standalone Next.js server at ${standaloneServerPath}`);
  }

  const command = useStandaloneServerForE2E
    ? process.execPath
    : isDev
      ? (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
      : getPackagedNodeCommand();
  const args = useStandaloneServerForE2E
    ? [standaloneServerPath]
    : runProdLikeServerForE2E
      ? ['start', '-p', PORT.toString(), '-H', '127.0.0.1']
      : isDev
        ? ['next', 'dev', '-p', PORT.toString(), '-H', '127.0.0.1']
        : [
            '-e',
            packagedBootstrapScript,
            app.getAppPath(),
          ];
  const serverEnv = useStandaloneServerForE2E
    ? {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
        HOSTNAME: '127.0.0.1',
      }
    : isDev
      ? env
      : {
          ...env,
          ELECTRON_RUN_AS_NODE: '1',
        };
  const workingDir = useStandaloneServerForE2E
    ? standaloneBasePath
    : isDev
      ? process.cwd()
      : process.resourcesPath;

  if (runProdLikeServerForE2E) {
    console.log('[Electron] E2E mode: starting production Next.js server');
  } else {
    console.log('[Electron] Starting Next.js server...');
  }
  try {
    serverProcess = spawn(command, args, {
      env: serverEnv,
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(detachChildProcesses && { detached: true }),
    });
  } catch (error) {
    console.error('[Electron] Failed to spawn server process:', error);
    return;
  }

  serverProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[Next] ${data.toString()}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[Next] ${data.toString()}`);
  });

  serverProcess.on('error', (error) => {
    console.error('[Electron] Server process error:', error);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Server process exited with code ${code}`);
  });
}

async function waitForServerReady(timeoutMs = isE2E ? 120000 : 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) {
      console.error(`[Electron] Server exited before becoming ready (code: ${serverProcess.exitCode})`);
      return false;
    }

    try {
      const controller = new AbortController();
      const requestTimeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/favicon.ico`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (response.status >= 200 && response.status < 500) {
          return true;
        }
      } finally {
        clearTimeout(requestTimeout);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  if (lastError) {
    console.error('[Electron] Timed out waiting for server:', lastError);
  } else {
    console.error('[Electron] Timed out waiting for server readiness');
  }
  return false;
}

function watcherBinaryName() {
  return process.platform === 'win32' ? 'watcher-rs.exe' : 'watcher-rs';
}

function getDevWatcherBinaryPath() {
  return path.join(process.cwd(), 'watcher-rs', 'target', 'release', watcherBinaryName());
}

function getPackagedWatcherBinaryPath() {
  return path.join(process.resourcesPath, 'watcher-rs', watcherBinaryName());
}

function getWatcherArgs(env: NodeJS.ProcessEnv) {
  return [
    '--library-path',
    env.LIBRARY_PATH ?? './data/library',
    '--db-path',
    env.DATABASE_PATH ?? './data/library.db',
    '--covers-path',
    env.COVERS_PATH ?? './data/covers',
  ];
}

function buildWatcherEnv(baseEnv: NodeJS.ProcessEnv, watcherDir: string) {
  const env = { ...baseEnv };

  if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
      ? `${watcherDir}:${env.LD_LIBRARY_PATH}`
      : watcherDir;
  } else if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH
      ? `${watcherDir}:${env.DYLD_LIBRARY_PATH}`
      : watcherDir;
  } else if (process.platform === 'win32') {
    env.PATH = env.PATH
      ? `${watcherDir};${env.PATH}`
      : watcherDir;
  }

  return env;
}

function startWatcher(libraryPath: string) {
  if (isE2E) {
    console.log('[Electron] E2E mode: skipping file watcher startup');
    return;
  }

  const baseEnv = getEnvVars(libraryPath);
  const watcherArgs = getWatcherArgs(baseEnv);
  const workingDir = isDev ? process.cwd() : process.resourcesPath;

  let command: string;
  let args: string[];
  let watcherDir: string;

  if (isDev) {
    const devBinary = getDevWatcherBinaryPath();
    if (fs.existsSync(devBinary)) {
      command = devBinary;
      args = watcherArgs;
      watcherDir = path.dirname(devBinary);
    } else {
      command = 'cargo';
      args = [
        'run',
        '--manifest-path',
        path.join(process.cwd(), 'watcher-rs', 'Cargo.toml'),
        '--release',
        '--',
        ...watcherArgs,
      ];
      watcherDir = path.join(process.cwd(), 'watcher-rs');
      console.warn('[Electron] watcher-rs release binary not found; falling back to cargo run --release');
    }
  } else {
    const packagedBinary = getPackagedWatcherBinaryPath();
    if (!fs.existsSync(packagedBinary)) {
      console.error(`[Electron] Packaged watcher binary not found: ${packagedBinary}`);
      return;
    }
    command = packagedBinary;
    args = watcherArgs;
    watcherDir = path.dirname(packagedBinary);
  }

  const watcherEnv = buildWatcherEnv(baseEnv, watcherDir);

  console.log('[Electron] Starting file watcher...');
  try {
    watcherProcess = spawn(command, args, {
      env: watcherEnv,
      cwd: workingDir,
      stdio: 'inherit',
      ...(detachChildProcesses && { detached: true }),
    });
  } catch (error) {
    console.error('[Electron] Failed to spawn watcher process:', error);
    return;
  }

  watcherProcess.on('error', (error) => {
    console.error('[Electron] Watcher process error:', error);
  });

  watcherProcess.on('exit', (code) => {
    console.log(`[Electron] Watcher process exited with code ${code}`);
  });
}

function killChildProcesses() {
  console.log('[Electron] Shutting down child processes...');

  for (const child of [serverProcess, watcherProcess]) {
    if (!child || child.pid == null) continue;
    try {
      if (detachChildProcesses) {
        // Detached child processes are their own process groups.
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      // Process may already be dead.
    }
  }

  serverProcess = null;
  watcherProcess = null;
}

function restartWatcher(libraryPath: string) {
  console.log('[Electron] Restarting watcher with new library path...');

  if (watcherProcess) {
    watcherProcess.kill();
    watcherProcess = null;
  }

  if (shouldStartWatcher(libraryPath)) {
    startWatcher(libraryPath);
  }
}

function isPortListening(port: number, host = '127.0.0.1') {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPortToClose(port: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listening = await isPortListening(port);
    if (!listening) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

function forceKillPortListener(port: number) {
  if (process.platform === 'win32') {
    return;
  }

  const result = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });

  if (result.error || !result.stdout) {
    return;
  }

  const pids = result.stdout
    .split(/\s+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
      console.warn(`[Electron] Force-killed lingering process on port ${port}: PID ${pid}`);
    } catch {
      // PID may already be gone.
    }
  }
}

async function stopServerProcess() {
  if (serverProcess && serverProcess.pid != null) {
    const exitingProcess = serverProcess;

    try {
      if (detachChildProcesses && exitingProcess.pid != null) {
        process.kill(-exitingProcess.pid, 'SIGKILL');
      } else {
        exitingProcess.kill('SIGKILL');
      }
    } catch {
      // Process may already be dead.
    }

    await Promise.race([
      new Promise<void>((resolve) => exitingProcess.once('exit', () => resolve())),
      sleep(2000),
    ]);
  }

  serverProcess = null;

  const portClosed = await waitForPortToClose(PORT, 3000);
  if (!portClosed) {
    console.warn(`[Electron] Port ${PORT} still in use after stopping server; attempting cleanup`);
    forceKillPortListener(PORT);
    await waitForPortToClose(PORT, 3000);
  }
}

async function restartServer(libraryPath: string) {
  console.log('[Electron] Restarting Next.js server...');
  await stopServerProcess();
  startServer(libraryPath);
  const ready = await waitForServerReady();
  if (!ready) {
    throw new Error('Next.js server did not become ready after restart');
  }
}

async function clearBooksTable(): Promise<boolean> {
  console.log('[Electron] Clearing books via API...');

  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/electron/clear-books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[Electron] API returned ${response.status}: ${response.statusText}`);
      return false;
    }

    const result = (await response.json()) as {
      success: boolean;
      deleted?: number;
      deletedCovers?: number;
      error?: string;
      message?: string;
    };
    console.log(`[Electron] Clear books result:`, result);

    if (result.success) {
      console.log(`[Electron] Successfully deleted ${result.deleted} books and ${result.deletedCovers} covers`);
      return true;
    } else {
      console.error('[Electron] API call failed:', result.error);
      return false;
    }
  } catch (error) {
    console.error('[Electron] Failed to clear books via API:', error);
    return false;
  }
}

async function selectLibraryPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Library Folder',
    message: 'Choose a folder containing your EPUB and PDF files',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  store.set('libraryPath', selectedPath);
  console.log(`[Electron] Library path set to: ${selectedPath}`);

  return selectedPath;
}

function saveWindowBounds() {
  if (!mainWindow) return;

  const bounds = mainWindow.getBounds();
  store.set('windowBounds', bounds);
}

function getMainWindowIconPath(): string | undefined {
  if (process.platform === 'win32') {
    const winIconPath = path.join(__dirname, '../icons/windows/icon.ico');
    return fs.existsSync(winIconPath) ? winIconPath : undefined;
  }

  if (process.platform === 'linux') {
    const linuxIconPath = path.join(__dirname, '../icons/linux/icons/512x512.png');
    return fs.existsSync(linuxIconPath) ? linuxIconPath : undefined;
  }

  return undefined;
}

function createWindow() {
  console.log('[Electron] Creating main window...');

  // Restore window bounds from store
  const savedBounds = store.get('windowBounds');
  const iconPath = getMainWindowIconPath();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: savedBounds?.width ?? 1200,
    height: savedBounds?.height ?? 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (iconPath) {
    windowOptions.icon = iconPath;
  }

  if (savedBounds?.x !== undefined && savedBounds?.y !== undefined) {
    windowOptions.x = savedBounds.x;
    windowOptions.y = savedBounds.y;
  }

  mainWindow = new BrowserWindow(windowOptions);
  console.log('[Electron] Window created, loading URL...');

  const startUrl = isFirstRun
    ? `http://127.0.0.1:${PORT}/onboarding`
    : `http://127.0.0.1:${PORT}`;
  mainWindow.loadURL(startUrl);

  if (isDev && !isE2E) {
    mainWindow.webContents.openDevTools();
  }

  // Create system tray (optional in dev mode if icons don't exist)
  try {
    createTray(mainWindow, async () => {
      const newPath = await selectLibraryPath();
      if (newPath) {
        restartWatcher(newPath);
      }
    });
    console.log('[Electron] System tray created');
  } catch (error) {
    console.warn('[Electron] Failed to create system tray (this is OK in dev mode):', error);
  }

  // Save window bounds on resize and move (debounced)
  let saveBoundsTimeout: NodeJS.Timeout | null = null;
  const debouncedSaveBounds = () => {
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
    saveBoundsTimeout = setTimeout(() => {
      saveWindowBounds();
    }, 500);
  };

  mainWindow.on('resize', debouncedSaveBounds);
  mainWindow.on('move', debouncedSaveBounds);

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('[Electron] Window setup complete');
}

function setMacAppIcon() {
  if (process.platform !== 'darwin') {
    return;
  }

  const candidatePaths = [
    path.join(__dirname, '../icons/macos/icon.icns'),
    path.join(__dirname, '../icons/macos/512x512.png'),
    path.join(__dirname, '../icons/macos/256x256.png'),
    path.join(process.resourcesPath, 'icon.icns'),
    path.join(process.resourcesPath, 'macos/icon.icns'),
    path.join(process.resourcesPath, 'macos/512x512.png'),
    path.join(process.resourcesPath, 'macos/256x256.png'),
  ];

  for (const iconPath of candidatePaths) {
    if (!fs.existsSync(iconPath)) {
      continue;
    }

    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
      return;
    }
  }

  console.warn('[Electron] Unable to load macOS app icon from known paths');
}

app.whenReady().then(async () => {
  setMacAppIcon();

  // Set up IPC handlers
  ipcMain.handle('select-library-path', async () => {
    const currentPath = store.get('libraryPath');
    const newPath = await selectLibraryPath();
    if (newPath) {
      // Stop watcher first
      if (watcherProcess) {
        console.log('[Electron] Stopping watcher before clearing...');
        watcherProcess.kill();
        watcherProcess = null;
        // Wait for watcher to fully stop
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Clear books table when changing library path
      if (currentPath && currentPath !== newPath) {
        console.log('[Electron] Library path changed, clearing books...');
        const success = await clearBooksTable();
        console.log(`[Electron] Clear books result: ${success}`);
        // Wait before restarting watcher to ensure UI can refresh
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Start watcher with new path
      console.log('[Electron] Starting watcher with new path...');
      startWatcher(newPath);
    }
    return newPath;
  });

  ipcMain.handle('rescan-library', () => {
    const libraryPath = store.get('libraryPath');
    if (libraryPath) {
      console.log('[Electron] Rescanning library...');
      restartWatcher(libraryPath);
      return true;
    }
    console.warn('[Electron] No library path set, cannot rescan');
    return false;
  });

  ipcMain.handle('nuke-and-rescan-library', async () => {
    const libraryPath = store.get('libraryPath');
    if (libraryPath) {
      console.log('[Electron] Nuking and rescanning library...');

      // Stop watcher first
      if (watcherProcess) {
        console.log('[Electron] Stopping watcher before clearing...');
        watcherProcess.kill();
        watcherProcess = null;
        // Wait for watcher to fully stop
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Clear books table
      console.log('[Electron] Clearing books table...');
      const success = await clearBooksTable();
      console.log(`[Electron] Clear books result: ${success}`);

      if (success) {
        // Wait before restarting watcher to ensure UI can refresh
        console.log('[Electron] Waiting before restarting watcher...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Restart watcher
        console.log('[Electron] Restarting watcher...');
        startWatcher(libraryPath);
      }

      return success;
    }
    console.warn('[Electron] No library path set, cannot nuke and rescan');
    return false;
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-local-ips', () => {
    const interfaces = os.networkInterfaces();
    const urls: string[] = [];
    for (const addrs of Object.values(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          urls.push(`http://${addr.address}:${PORT}`);
        }
      }
    }
    return urls;
  });

  ipcMain.handle('get-library-path', () => {
    return store.get('libraryPath') || '';
  });

  ipcMain.handle('get-storage-mode', () => {
    return store.get('storageMode') || 'local';
  });

  ipcMain.handle('get-s3-config', () => {
    return store.get('s3Config') || null;
  });

  ipcMain.handle('save-s3-config', async (_event, config: {
    endpoint?: string;
    region?: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    prefix?: string;
    pollInterval?: number;
  }) => {
    try {
      store.set('s3Config', config);
      store.set('storageMode', 's3');

      // Stop watcher, clear books, restart with S3 config
      if (watcherProcess) {
        watcherProcess.kill();
        watcherProcess = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      await clearBooksTable();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const libraryPath = store.get('libraryPath') || '';
      await restartServer(libraryPath);
      startWatcher(libraryPath);

      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to save S3 config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('switch-to-local-storage', async () => {
    try {
      store.set('storageMode', 'local');

      // Stop watcher, clear books, restart in local mode
      if (watcherProcess) {
        watcherProcess.kill();
        watcherProcess = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      await clearBooksTable();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const libraryPath = store.get('libraryPath');
      await restartServer(libraryPath || '');
      if (libraryPath) {
        startWatcher(libraryPath);
      }

      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to switch to local storage:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('select-library-path-initial', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Library Folder',
      message: 'Choose a folder containing your EPUB and PDF files',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];
    store.set('libraryPath', selectedPath);
    console.log(`[Electron] Initial library path set to: ${selectedPath}`);
    return selectedPath;
  });

  ipcMain.handle('complete-onboarding', () => {
    const libPath = store.get('libraryPath');
    const mode = store.get('storageMode');

    // Local mode requires a library path; S3 mode does not
    if (mode !== 's3' && !libPath) {
      return { success: false, error: 'No library path set' };
    }

    try {
      startWatcher(libPath || '');
      isFirstRun = false;
      return { success: true };
    } catch (error) {
      console.error('[Electron] Onboarding setup failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('reset-app', async () => {
    try {
      console.log('[Electron] Resetting app...');

      // Stop watcher if running
      if (watcherProcess) {
        watcherProcess.kill();
        watcherProcess = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Clear all books via API
      const success = await clearBooksTable();
      if (!success) {
        console.error('[Electron] Failed to clear books during reset');
      }

      // Clear library path from store
      store.set('libraryPath', '');
      isFirstRun = true;

      console.log('[Electron] App reset complete');
      return { success: true };
    } catch (error) {
      console.error('[Electron] App reset failed:', error);
      return { success: false };
    }
  });

  // First-run detection
  const libraryPath = store.get('libraryPath') || '';
  if (!libraryPath && !isS3Configured()) {
    console.log('[Electron] First run detected, will show onboarding page');
    isFirstRun = true;
  }

  // Check if running in dev mode with external server (electron:dev script)
  const useExternalServer = process.env.ELECTRON_DEV_MODE === 'true';

  if (!useExternalServer) {
    // Production mode: Electron manages all processes
    console.log('[Electron] Production mode: starting server and watcher');
    if (isE2E) {
      console.log('[Electron] E2E mode: skipping db setup (handled by test harness)');
    } else {
      runDbSetup(libraryPath);
    }
    startServer(libraryPath);
    if (shouldStartWatcher(libraryPath)) {
      startWatcher(libraryPath);
    }

    const serverReady = await waitForServerReady();
    if (!serverReady) {
      dialog.showErrorBox(
        'Server failed to start',
        `Next.js server did not start on http://127.0.0.1:${PORT}. Check logs prefixed with [Next].`,
      );
      return;
    }

    createWindow();
  } else {
    // Dev mode: server is already running externally via concurrently
    console.log('[Electron] Dev mode: using external server');

    // Check if database exists, if not run setup
    const paths = getDataPaths(libraryPath);
    const dbExists = fs.existsSync(paths.databasePath);

    if (!dbExists) {
      console.log('[Electron] Database not found, running initial setup...');
      runDbSetup(libraryPath);
    }

    // Start watcher only (server is running externally)
    if (shouldStartWatcher(libraryPath)) {
      startWatcher(libraryPath);
    }

    // Server is already running, create window immediately
    createWindow();
  }

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  destroyTray();
  killChildProcesses();
});

const handleProcessSignal = () => {
  isQuitting = true;
  destroyTray();
  killChildProcesses();
  app.quit();
};

process.on('SIGINT', handleProcessSignal);
process.on('SIGTERM', handleProcessSignal);

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
