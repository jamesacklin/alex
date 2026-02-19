import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
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

function getEnvVars(libraryPath: string) {
  const paths = getDataPaths(libraryPath);
  const nextauthSecret = store.get('nextauthSecret');

  return {
    ...process.env,
    DATABASE_PATH: paths.databasePath,
    LIBRARY_PATH: paths.libraryPath,
    COVERS_PATH: paths.coversPath,
    PORT: PORT.toString(),
    ALEX_DESKTOP: 'true',
    NEXTAUTH_SECRET: nextauthSecret,
    NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
  };
}

function runDbSetup(libraryPath: string) {
  if (!isDev) {
    const env = getEnvVars(libraryPath);
    const databasePath = env.DATABASE_PATH;
    if (!databasePath) {
      console.error('[Electron] DATABASE_PATH is not set; skipping packaged database setup');
      return;
    }

    const absoluteDatabasePath = path.resolve(databasePath);
    const migrationPath = path.join(app.getAppPath(), 'src/lib/db/migrations/0000_wide_expediter.sql');

    try {
      if (!fs.existsSync(migrationPath)) {
        console.error(`[Electron] Migration file not found: ${migrationPath}`);
        return;
      }

      fs.mkdirSync(path.dirname(absoluteDatabasePath), { recursive: true });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite3 = require('better-sqlite3') as new (filename: string) => {
        pragma: (sql: string) => void;
        prepare: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => unknown };
        exec: (sql: string) => void;
        transaction: (fn: () => void) => () => void;
        close: () => void;
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bcrypt = require('bcryptjs') as { hashSync: (value: string, rounds: number) => string };
      const db = new BetterSqlite3(absoluteDatabasePath);

      try {
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        const usersTableExists = db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
          .get();

        if (!usersTableExists) {
          const migrationSql = fs.readFileSync(migrationPath, 'utf8');
          const statements = migrationSql
            .split('--> statement-breakpoint')
            .map((statement) => statement.trim())
            .filter((statement) => statement.length > 0);

          const runMigration = db.transaction(() => {
            for (const statement of statements) {
              db.exec(statement);
            }
          });
          runMigration();
          console.log('[Electron] Database schema initialized for packaged build');
        }

        // Ensure unique indexes exist on books table (fixes databases created
        // before the indexes were added to the migration).
        const hasFileHashIndex = db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'books_file_hash_unique' LIMIT 1")
          .get();

        if (!hasFileHashIndex) {
          console.log('[Electron] Missing unique indexes on books table, applying fix...');

          // Remove duplicate books before creating unique indexes.
          // Keep the earliest entry (lowest added_at) for each file_hash.
          db.exec(`
            DELETE FROM books WHERE id IN (
              SELECT b.id FROM books b
              INNER JOIN (
                SELECT file_hash, MIN(added_at) AS min_added
                FROM books GROUP BY file_hash HAVING COUNT(*) > 1
              ) d ON b.file_hash = d.file_hash AND b.added_at > d.min_added
            )
          `);

          // Also deduplicate by file_path.
          db.exec(`
            DELETE FROM books WHERE id IN (
              SELECT b.id FROM books b
              INNER JOIN (
                SELECT file_path, MIN(added_at) AS min_added
                FROM books GROUP BY file_path HAVING COUNT(*) > 1
              ) d ON b.file_path = d.file_path AND b.added_at > d.min_added
            )
          `);

          db.exec('CREATE UNIQUE INDEX IF NOT EXISTS `books_file_path_unique` ON `books` (`file_path`)');
          db.exec('CREATE UNIQUE INDEX IF NOT EXISTS `books_file_hash_unique` ON `books` (`file_hash`)');
          console.log('[Electron] Unique indexes created and duplicates cleaned up');
        }

        const adminEmail = 'admin@localhost';
        const existingAdmin = db.prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1').get(adminEmail);
        if (!existingAdmin) {
          const now = Math.floor(Date.now() / 1000);
          const passwordHash = bcrypt.hashSync('admin123', 10);
          db.prepare(
            'INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run('1', adminEmail, passwordHash, 'Admin', 'admin', now, now);
          console.log('[Electron] Seeded default admin user for packaged build');
        }
      } finally {
        db.close();
      }
    } catch (error) {
      console.error('[Electron] Packaged database setup failed:', error);
    }
    return;
  }

  const env = getEnvVars(libraryPath);
  const workingDir = process.cwd();

  console.log('[Electron] Running database migration...');
  try {
    execSync('pnpm exec drizzle-kit push', {
      stdio: 'inherit',
      env,
      cwd: workingDir,
    });
    console.log('[Electron] Database migration complete');
  } catch (error) {
    console.error('[Electron] Database migration failed:', error);
  }

  console.log('[Electron] Running database seed...');
  try {
    execSync('pnpm exec tsx src/lib/db/seed.ts', {
      stdio: 'inherit',
      env,
      cwd: workingDir,
    });
    console.log('[Electron] Database seed complete');
  } catch (error) {
    console.error('[Electron] Database seed failed:', error);
  }
}

function startServer(libraryPath: string) {
  const env = getEnvVars(libraryPath);
  const runProdLikeServerForE2E = isDev && isE2E;
  const packagedBootstrapScript = [
    "const Module=require('node:module')",
    "const path=require('node:path')",
    "const originalResolveFilename=Module._resolveFilename",
    "Module._resolveFilename=function(request,parent,isMain,options){",
    "if(/^better-sqlite3-[a-f0-9]{8,}$/i.test(request))request='better-sqlite3'",
    "if(/^canvas-[a-f0-9]{8,}$/i.test(request))request='canvas'",
    'return originalResolveFilename.call(this,request,parent,isMain,options)',
    '}',
    'const chdir=process.chdir.bind(process)',
    "process.chdir=(directory)=>{try{chdir(directory)}catch(error){if(!error||error.code!=='ENOTDIR')throw error}}",
    "require(path.join(process.argv[1],'.next/standalone/server.js'))",
  ].join(';');
  const command = isDev
    ? (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
    : getPackagedNodeCommand();
  const args = runProdLikeServerForE2E
    ? ['start', '-p', PORT.toString(), '-H', '127.0.0.1']
    : isDev
      ? ['next', 'dev', '-p', PORT.toString(), '-H', '127.0.0.1']
      : [
          '-e',
          packagedBootstrapScript,
          app.getAppPath(),
        ];
  const serverEnv = isDev
    ? env
    : {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
      };
  const workingDir = isDev ? app.getAppPath() : process.resourcesPath;

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
      ...(process.platform !== 'win32' && { detached: true }),
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
      ...(process.platform !== 'win32' && { detached: true }),
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
      // Kill the entire process group so that child processes (e.g. the
      // Next.js server spawned by pnpm) are also terminated.
      if (process.platform !== 'win32') {
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.kill();
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

  if (libraryPath) {
    startWatcher(libraryPath);
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
    path.join(process.resourcesPath, 'icon.icns'),
    path.join(process.resourcesPath, 'macos/icon.icns'),
  ];

  const iconPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (!iconPath) {
    console.warn('[Electron] macOS app icon not found in expected locations');
    return;
  }

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.warn(`[Electron] Failed to load macOS app icon: ${iconPath}`);
    return;
  }

  app.dock.setIcon(icon);
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

  ipcMain.handle('get-library-path', () => {
    return store.get('libraryPath') || '';
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
    if (!libPath) {
      return { success: false, error: 'No library path set' };
    }

    try {
      startWatcher(libPath);
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
  if (!libraryPath) {
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
    if (libraryPath) {
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
    if (libraryPath) {
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

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
