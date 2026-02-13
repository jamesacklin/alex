import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import { store } from './store';
import { getDataPaths } from './paths';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let watcherProcess: ChildProcess | null = null;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const libraryPath = store.get('libraryPath') || '';

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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  killChildProcesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
