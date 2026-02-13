import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import { store } from './store';
import { getDataPaths } from './paths';
import { createTray, destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let watcherProcess: ChildProcess | null = null;
let isQuitting = false;

const PORT = 3210;
const isDev = !app.isPackaged;

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
    NEXTAUTH_URL: `http://localhost:${PORT}`,
  };
}

function runDbSetup(libraryPath: string) {
  const env = getEnvVars(libraryPath);

  console.log('[Electron] Running database migration...');
  try {
    execSync('npx drizzle-kit push', {
      stdio: 'inherit',
      env,
      cwd: app.getAppPath(),
    });
    console.log('[Electron] Database migration complete');
  } catch (error) {
    console.error('[Electron] Database migration failed:', error);
  }

  console.log('[Electron] Running database seed...');
  try {
    execSync('npx tsx src/lib/db/seed.ts', {
      stdio: 'inherit',
      env,
      cwd: app.getAppPath(),
    });
    console.log('[Electron] Database seed complete');
  } catch (error) {
    console.error('[Electron] Database seed failed:', error);
  }
}

function startServer(libraryPath: string) {
  const env = getEnvVars(libraryPath);

  const command = isDev ? 'npx' : 'node';
  const args = isDev
    ? ['next', 'dev', '-p', PORT.toString()]
    : ['.next/standalone/server.js'];

  console.log('[Electron] Starting Next.js server...');
  serverProcess = spawn(command, args, {
    env,
    cwd: app.getAppPath(),
    stdio: 'inherit',
  });

  serverProcess.on('error', (error) => {
    console.error('[Electron] Server process error:', error);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Server process exited with code ${code}`);
  });
}

function startWatcher(libraryPath: string) {
  const env = getEnvVars(libraryPath);

  console.log('[Electron] Starting file watcher...');
  watcherProcess = spawn('npx', ['tsx', 'watcher/index.ts'], {
    env,
    cwd: app.getAppPath(),
    stdio: 'inherit',
  });

  watcherProcess.on('error', (error) => {
    console.error('[Electron] Watcher process error:', error);
  });

  watcherProcess.on('exit', (code) => {
    console.log(`[Electron] Watcher process exited with code ${code}`);
  });
}

function killChildProcesses() {
  console.log('[Electron] Shutting down child processes...');

  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }

  if (watcherProcess) {
    watcherProcess.kill();
    watcherProcess = null;
  }
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

function createWindow() {
  // Restore window bounds from store
  const savedBounds = store.get('windowBounds');
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: savedBounds?.width ?? 1200,
    height: savedBounds?.height ?? 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (savedBounds?.x !== undefined && savedBounds?.y !== undefined) {
    windowOptions.x = savedBounds.x;
    windowOptions.y = savedBounds.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadURL(`http://localhost:${PORT}`);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Create system tray
  createTray(mainWindow, async () => {
    const newPath = await selectLibraryPath();
    if (newPath) {
      restartWatcher(newPath);
    }
  });

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
}

app.whenReady().then(async () => {
  // Set up IPC handlers
  ipcMain.handle('select-library-path', async () => {
    const newPath = await selectLibraryPath();
    if (newPath) {
      restartWatcher(newPath);
    }
    return newPath;
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // First-run: prompt for library path if not set
  let libraryPath = store.get('libraryPath') || '';
  if (!libraryPath) {
    console.log('[Electron] First run detected, prompting for library path...');
    const selectedPath = await selectLibraryPath();
    if (selectedPath) {
      libraryPath = selectedPath;
    }
  }

  // Initialize database
  runDbSetup(libraryPath);

  // Start processes
  startServer(libraryPath);
  if (libraryPath) {
    startWatcher(libraryPath);
  }

  // Wait a bit for the server to start, then create window
  setTimeout(() => {
    createWindow();
  }, 3000);

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
