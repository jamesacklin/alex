import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { randomBytes } from 'crypto';
import { spawn, ChildProcess, spawnSync } from 'child_process';
import {
  getS3Config as readS3Config,
  hasStoredS3Secret,
  migrateS3SecretToKeychain,
  setS3Config,
  store,
  type S3Config,
} from './store';
import { getDataPaths, isLibraryPathAvailable } from './paths';
import {
  DESKTOP_PRINCIPAL_DISPLAY_NAME,
  DESKTOP_PRINCIPAL_EMAIL,
  DESKTOP_PRINCIPAL_ID,
  NON_LOGIN_PASSWORD_HASH,
} from './shared-constants';
import { createTray, destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let watcherProcess: ChildProcess | null = null;
let tunnelProcess: ChildProcess | null = null;
let isQuitting = false;
let isFirstRun = false;

const RELAY_URL = 'wss://relay.alexreader.app/_tunnel/ws';
const TUNNEL_DOMAIN = 'alexreader.app';

const PORT = 3210;
const DESKTOP_AUTH_HEADER = 'x-alex-desktop-auth';
const isDev = !app.isPackaged;
const isE2E = process.env.ALEX_E2E === 'true';
const detachChildProcesses = process.platform !== 'win32' && !isDev;
const desktopAuthToken = process.env.ALEX_DESKTOP_AUTH_TOKEN || randomBytes(32).toString('hex');
let desktopAuthHeaderInjectionConfigured = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configureDesktopAuthHeaderInjection() {
  if (desktopAuthHeaderInjectionConfigured) {
    return;
  }

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`http://127.0.0.1:${PORT}/*`] },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          [DESKTOP_AUTH_HEADER]: desktopAuthToken,
        },
      });
    },
  );

  desktopAuthHeaderInjectionConfigured = true;
}

const APP_ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * Deny every renderer capability the reader does not need (F03).
 *
 * A malicious EPUB is untrusted content that the owner opens deliberately.
 * Even with its own scripting disabled it should not be able to reach for a
 * camera, a clipboard read, a notification, or a media device, so the
 * default session refuses all permission requests outright rather than
 * prompting.
 */
function configureRendererRestrictions() {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
}

/**
 * True when an IPC message came from the main frame of our own window
 * loading our own origin.
 *
 * Electron's own guidance is to validate the sender of every IPC message.
 * Without this, any frame the renderer ends up hosting — including the
 * iframe an EPUB is rendered into — can invoke privileged handlers such as
 * `get-s3-config`, `reset-app` or `nuke-and-rescan-library`.
 */
function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;

  // Sub-frames (an EPUB's iframe, an embedded SVG document) are never trusted.
  if (frame.parent !== null) return false;

  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;

  try {
    return new URL(frame.url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Register an IPC handler that only answers trusted senders.
 *
 * Every handler goes through here, so adding one cannot accidentally skip
 * the check.
 */
function handleTrusted<Args extends unknown[], Result>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Result,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn(`[Electron] Rejected IPC "${channel}" from an untrusted frame: ${event.senderFrame?.url}`);
      throw new Error('Unauthorized IPC sender');
    }
    return handler(event, ...(args as Args));
  });
}

/**
 * Keep a window pinned to the local app and refuse to open anything else.
 *
 * Book content can contain links, embedded SVG and frame navigations. None
 * of them may move the window off our origin or spawn a new Electron window
 * with renderer privileges; external links open in the user's browser
 * instead, where they are just web pages.
 */
function restrictWindowNavigation(window: BrowserWindow) {
  const isAppUrl = (candidate: string) => {
    try {
      return new URL(candidate).origin === APP_ORIGIN;
    } catch {
      return false;
    }
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(safeProtocol(url))) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^https?:$/.test(safeProtocol(url))) {
        void shell.openExternal(url);
      }
    }
  });

  window.webContents.on('will-frame-navigate', (event) => {
    // Sub-frames render book content; they must stay on our origin (epub.js
    // loads chapters through srcdoc/blob, never by navigating away).
    if (!event.isMainFrame && !isAppUrl(event.url) && !isInlineFrameUrl(event.url)) {
      event.preventDefault();
    }
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  window.webContents.on('did-create-window', (created) => {
    created.destroy();
  });
}

function safeProtocol(candidate: string): string {
  try {
    return new URL(candidate).protocol;
  } catch {
    return '';
  }
}

/** Protocols epub.js legitimately uses inside its rendering frame. */
function isInlineFrameUrl(candidate: string): boolean {
  const protocol = safeProtocol(candidate);
  return protocol === 'about:' || protocol === 'blob:' || protocol === 'data:';
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

function isS3Configured() {
  const mode = store.get('storageMode') || 'local';
  const config = store.get('s3Config');
  return mode === 's3' && !!(config?.bucket && config?.accessKey) && hasStoredS3Secret();
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
  const s3Config = readS3Config();
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
    ALEX_DESKTOP_AUTH_TOKEN: desktopAuthToken,
    NEXTAUTH_SECRET: nextauthSecret,
    NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
  };
}

type WatcherDbAction = 'query-all' | 'query-one' | 'execute' | 'transaction' | 'migrate';
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
  request: { sql: string; params?: unknown[] } | { statements: unknown[] } | null,
  env: NodeJS.ProcessEnv,
) {
  const dbPath = env.DATABASE_PATH;
  if (!dbPath) {
    throw new Error('DATABASE_PATH is not set');
  }

  const binaryPath = isDev ? resolveDevWatcherDbBinary() : getPackagedWatcherBinaryPath();
  if (!isDev && !fs.existsSync(binaryPath)) {
    throw new Error(`Packaged watcher binary not found: ${binaryPath}`);
  }

  const result = spawnSync(binaryPath, ['db', '--db-path', dbPath, action], {
    cwd: isDev ? process.cwd() : process.resourcesPath,
    env,
    input: request === null ? '' : JSON.stringify(request),
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
  return JSON.parse(payload) as {
    row?: unknown;
    rows?: unknown[];
    changes?: number;
    results?: unknown[];
    applied?: { version: number; name: string }[];
    version?: number | null;
  };
}

/**
 * Bring the database up to date using the canonical migration runner.
 *
 * Migrations, their ordering and the applied-version ledger all live in
 * watcher-rs, which embeds the SQL at compile time. Electron no longer keeps
 * its own copy of the schema logic, and no longer hunts the filesystem for a
 * migration file it can silently fail to find.
 *
 * Returns false when the database could not be prepared. The caller must not
 * start serving on a failure: the old code caught the error, logged it and
 * carried on, so the app came up against a half-built schema.
 */
function runMigrations(libraryPath: string): boolean {
  const env = getEnvVars(libraryPath);
  const databasePath = env.DATABASE_PATH;
  if (!databasePath) {
    console.error('[Electron] DATABASE_PATH is not set; cannot prepare the database');
    return false;
  }

  try {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });

    const result = runWatcherDbCommand('migrate', null, env) as {
      applied?: { version: number; name: string }[];
      version?: number | null;
    };

    for (const migration of result.applied ?? []) {
      console.log(
        `[Electron] Applied migration ${String(migration.version).padStart(4, '0')}_${migration.name}`,
      );
    }
    console.log(`[Electron] Database schema ready (version ${result.version ?? 'unknown'})`);
  } catch (error) {
    console.error('[Electron] Database migration failed:', error);
    return false;
  }

  return ensureDesktopPrincipal(getEnvVars(libraryPath));
}

/**
 * Make sure the synthetic desktop account row exists.
 *
 * Reading progress and collections reference `users(id)`, so the desktop
 * principal has to be a real row. It is created with a sentinel password
 * hash that is not a bcrypt digest, which the credentials provider refuses
 * outright — so enabling the public tunnel cannot expose a login for it
 * (F01). Remote access requires the owner to create a real account in
 * Admin -> Users.
 *
 * An existing row is never modified: whatever the owner has set stays set.
 */
function ensureDesktopPrincipal(env: NodeJS.ProcessEnv): boolean {
  try {
    const now = Math.floor(Date.now() / 1000);
    const result = runWatcherDbCommand(
      'execute',
      {
        sql: `
          INSERT INTO users (
            id, email, password_hash, display_name, role,
            session_version, created_at, updated_at
          )
          VALUES (?1, ?2, ?3, ?4, 'admin', 1, ?5, ?5)
          ON CONFLICT(email) DO NOTHING
        `,
        params: [
          DESKTOP_PRINCIPAL_ID,
          DESKTOP_PRINCIPAL_EMAIL,
          NON_LOGIN_PASSWORD_HASH,
          DESKTOP_PRINCIPAL_DISPLAY_NAME,
          now,
        ],
      },
      env,
    ) as { changes?: number };

    if (result.changes) {
      console.log('[Electron] Created the local desktop account (no remote login)');
    }
    return true;
  } catch (error) {
    console.error('[Electron] Failed to ensure the desktop account:', error);
    return false;
  }
}

/** Count accounts that can actually authenticate over the network. */
function countLoginCapableAccounts(libraryPath: string): number {
  const env = getEnvVars(libraryPath);
  const row = runWatcherDbCommand(
    'query-one',
    {
      sql: `
        SELECT COUNT(*) AS total
        FROM users
        WHERE disabled_at IS NULL
          AND password_hash LIKE '$2%'
      `,
    },
    env,
  ).row as { total?: number } | undefined;

  return Number(row?.total ?? 0);
}

type S3ConfigInput = Omit<S3Config, 'secretKey'> & { secretKey: string };

/**
 * Validate an S3 settings payload from the renderer.
 *
 * The IPC boundary is untyped at runtime; the previous handler destructured
 * whatever arrived and persisted it.
 */
function parseS3ConfigInput(
  input: unknown,
): { config: S3ConfigInput } | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Invalid S3 settings' };
  }

  const raw = input as Record<string, unknown>;
  const optionalString = (value: unknown, field: string) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new Error(`${field} must be text`);
    return value.trim() || undefined;
  };

  try {
    const bucket = typeof raw.bucket === 'string' ? raw.bucket.trim() : '';
    const accessKey = typeof raw.accessKey === 'string' ? raw.accessKey.trim() : '';
    if (!bucket) return { error: 'A bucket name is required' };
    if (!accessKey) return { error: 'An access key ID is required' };

    const endpoint = optionalString(raw.endpoint, 'Endpoint');
    if (endpoint && !/^https?:\/\//.test(endpoint)) {
      return { error: 'Endpoint must be an http(s) URL' };
    }

    let pollInterval: number | undefined;
    if (raw.pollInterval !== undefined && raw.pollInterval !== null && raw.pollInterval !== '') {
      const value = Number(raw.pollInterval);
      if (!Number.isFinite(value) || value < 5 || value > 86_400) {
        return { error: 'Poll interval must be between 5 and 86400 seconds' };
      }
      pollInterval = Math.floor(value);
    }

    return {
      config: {
        bucket,
        accessKey,
        secretKey: typeof raw.secretKey === 'string' ? raw.secretKey : '',
        endpoint,
        region: optionalString(raw.region, 'Region'),
        prefix: optionalString(raw.prefix, 'Prefix'),
        pollInterval,
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid S3 settings' };
  }
}

/**
 * Source identity for an S3 config.
 *
 * Endpoint, region, bucket and prefix together decide *which* objects the
 * scanner reconciles against; the credentials decide whether it can read
 * them. Two configs are equal when both halves match.
 */
function s3ConfigsEqual(a: S3Config, b: S3Config): boolean {
  const normalize = (config: S3Config) => [
    config.endpoint ?? '',
    config.region ?? '',
    config.bucket,
    config.prefix ?? '',
    String(config.pollInterval ?? ''),
    config.accessKey,
    config.secretKey,
  ].join('\u0000');

  return normalize(a) === normalize(b);
}

/** List one page of objects to prove the credentials and scope work. */
function checkS3Connectivity(config: S3Config): { ok: true } | { ok: false; error: string } {
  const binaryPath = isDev ? resolveDevWatcherDbBinary() : getPackagedWatcherBinaryPath();
  if (!fs.existsSync(binaryPath)) {
    return { ok: false, error: `watcher binary not found at ${binaryPath}` };
  }

  const args = [
    's3-check',
    '--s3-bucket', config.bucket,
    '--s3-access-key', config.accessKey,
    '--s3-secret-key', config.secretKey,
  ];
  if (config.endpoint) args.push('--s3-endpoint', config.endpoint);
  if (config.region) args.push('--s3-region', config.region);
  if (config.prefix) args.push('--s3-prefix', config.prefix);

  const result = spawnSync(binaryPath, args, {
    cwd: isDev ? process.cwd() : process.resourcesPath,
    env: buildWatcherEnv(process.env, path.dirname(binaryPath)),
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  const payload = result.stdout?.trim();
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as { ok?: boolean; error?: string };
      if (parsed.ok) return { ok: true };
      return { ok: false, error: parsed.error || 'unknown error' };
    } catch {
      // Fall through to the exit-code check.
    }
  }

  if (result.status === 0) return { ok: true };
  return { ok: false, error: result.stderr?.trim() || `check exited with code ${result.status}` };
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

  if (libraryPath && !isLibraryPathAvailable(libraryPath)) {
    // The watcher still starts (it may be an S3 install, and the volume may
    // come back), but say so plainly: an unreachable source is not an empty
    // library, and the scanner deliberately declines to treat it as one.
    console.warn(
      `[Electron] Library folder is not reachable right now: ${libraryPath}. `
        + 'Books already indexed from it are kept until it comes back.',
    );
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

  for (const child of [serverProcess, watcherProcess, tunnelProcess]) {
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
  tunnelProcess = null;
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

function generateTunnelSubdomain(): string {
  const adjectives = [
    'amber', 'ancient', 'autumn', 'blazing', 'bold', 'brave', 'bright', 'calm',
    'clever', 'cool', 'cosmic', 'crisp', 'crystal', 'curious', 'dancing', 'daring',
    'deep', 'divine', 'dreamy', 'eager', 'emerald', 'endless', 'fading', 'fierce',
    'gentle', 'gilded', 'golden', 'graceful', 'green', 'hidden', 'humble', 'hushed',
    'ivory', 'jade', 'keen', 'lasting', 'leafy', 'light', 'lively', 'lunar',
    'magic', 'mellow', 'mighty', 'misty', 'moonlit', 'morning', 'mossy', 'noble',
    'pale', 'peaceful', 'quiet', 'radiant', 'rapid', 'rising', 'rosy', 'rustic',
    'sacred', 'serene', 'shining', 'silent', 'silver', 'sleepy', 'smooth', 'snowy',
    'soft', 'solar', 'sparkling', 'spring', 'steady', 'still', 'summer', 'sunny',
    'sweet', 'swift', 'tender', 'tidal', 'tranquil', 'twilight', 'vast', 'velvet',
    'vivid', 'wandering', 'warm', 'western', 'wild', 'winding', 'winter', 'wise',
  ];
  const nouns = [
    'aurora', 'bay', 'beacon', 'birch', 'bloom', 'boulder', 'breeze', 'bridge',
    'brook', 'canyon', 'cedar', 'cliff', 'cloud', 'coral', 'cove', 'creek',
    'crystal', 'dawn', 'delta', 'dew', 'drift', 'dune', 'dusk', 'eagle',
    'echo', 'elm', 'ember', 'falcon', 'fern', 'fjord', 'flame', 'forest',
    'fountain', 'frost', 'garden', 'glade', 'glen', 'grove', 'harbor', 'haven',
    'hawk', 'heath', 'heron', 'hill', 'horizon', 'island', 'jade', 'lake',
    'lark', 'laurel', 'leaf', 'lily', 'lotus', 'maple', 'meadow', 'mesa',
    'mist', 'moon', 'moss', 'mountain', 'oak', 'ocean', 'orchid', 'owl',
    'palm', 'path', 'peak', 'pearl', 'pine', 'prairie', 'rain', 'raven',
    'reef', 'ridge', 'river', 'rock', 'rose', 'sage', 'sand', 'sea',
    'shore', 'sky', 'snow', 'spark', 'spring', 'star', 'stone', 'storm',
    'stream', 'summit', 'sun', 'surf', 'swan', 'temple', 'tide', 'trail',
    'tree', 'valley', 'vine', 'vista', 'wave', 'whisper', 'willow', 'wind',
  ];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(adjectives)}-${pick(adjectives)}-${pick(nouns)}`;
}

function startTunnel() {
  const subdomain = store.get('tunnelSubdomain');
  if (!subdomain) {
    console.error('[Electron] No tunnel subdomain configured');
    return;
  }

  const secret = store.get('tunnelSecret');
  if (!secret) {
    // A name with no ownership proof cannot be registered any more (F02).
    console.error(
      '[Electron] No tunnel ownership secret for this name. Generate a new public URL to claim one.',
    );
    return;
  }

  // The secret travels in the environment rather than argv so it does not
  // show up in the process table next to the public hostname.
  const baseEnv = {
    ...getEnvVars(store.get('libraryPath') || ''),
    ALEX_TUNNEL_SECRET: secret,
  };
  const workingDir = isDev ? process.cwd() : process.resourcesPath;

  let command: string;
  let args: string[];
  let watcherDir: string;

  const tunnelArgs = [
    'tunnel',
    '--subdomain', subdomain,
    '--relay-url', RELAY_URL,
    '--local-addr', `127.0.0.1:${PORT}`,
  ];

  if (isDev) {
    const devBinary = getDevWatcherBinaryPath();
    if (fs.existsSync(devBinary)) {
      command = devBinary;
      args = tunnelArgs;
      watcherDir = path.dirname(devBinary);
    } else {
      command = 'cargo';
      args = [
        'run',
        '--manifest-path',
        path.join(process.cwd(), 'watcher-rs', 'Cargo.toml'),
        '--release',
        '--',
        ...tunnelArgs,
      ];
      watcherDir = path.join(process.cwd(), 'watcher-rs');
    }
  } else {
    const packagedBinary = getPackagedWatcherBinaryPath();
    if (!fs.existsSync(packagedBinary)) {
      console.error(`[Electron] Packaged watcher binary not found: ${packagedBinary}`);
      return;
    }
    command = packagedBinary;
    args = tunnelArgs;
    watcherDir = path.dirname(packagedBinary);
  }

  const tunnelEnv = buildWatcherEnv(baseEnv, watcherDir);

  console.log(`[Electron] Starting tunnel (subdomain: ${subdomain})...`);
  try {
    tunnelProcess = spawn(command, args, {
      env: tunnelEnv,
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(detachChildProcesses && { detached: true }),
    });
  } catch (error) {
    console.error('[Electron] Failed to spawn tunnel process:', error);
    return;
  }

  tunnelProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[Tunnel] ${data.toString()}`);
  });

  tunnelProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[Tunnel] ${data.toString()}`);
  });

  tunnelProcess.on('error', (error) => {
    console.error('[Electron] Tunnel process error:', error);
  });

  tunnelProcess.on('exit', (code) => {
    console.log(`[Electron] Tunnel process exited with code ${code}`);
    tunnelProcess = null;
  });
}

function stopTunnel() {
  if (!tunnelProcess || tunnelProcess.pid == null) {
    tunnelProcess = null;
    return;
  }

  try {
    if (detachChildProcesses) {
      process.kill(-tunnelProcess.pid, 'SIGTERM');
    } else {
      tunnelProcess.kill('SIGTERM');
    }
  } catch {
    // Process may already be dead.
  }

  tunnelProcess = null;
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
        [DESKTOP_AUTH_HEADER]: desktopAuthToken,
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
      // The preload only uses contextBridge + ipcRenderer, both of which
      // work in a sandboxed renderer, so there is no reason to leave the
      // OS-level sandbox off.
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nodeIntegrationInSubFrames: false,
      // Book content is rendered in an iframe; it must never get its own
      // Electron window with renderer privileges.
      webviewTag: false,
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
  restrictWindowNavigation(mainWindow);
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
      // `app.dock` is undefined off macOS (and typed that way since Electron 36).
      app.dock?.setIcon(icon);
      return;
    }
  }

  console.warn('[Electron] Unable to load macOS app icon from known paths');
}

app.whenReady().then(async () => {
  setMacAppIcon();
  configureDesktopAuthHeaderInjection();
  configureRendererRestrictions();
  migrateS3SecretToKeychain();

  // Set up IPC handlers
  handleTrusted('select-library-path', async () => {
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

  handleTrusted('rescan-library', () => {
    const libraryPath = store.get('libraryPath');
    if (libraryPath) {
      console.log('[Electron] Rescanning library...');
      restartWatcher(libraryPath);
      return true;
    }
    console.warn('[Electron] No library path set, cannot rescan');
    return false;
  });

  handleTrusted('nuke-and-rescan-library', async () => {
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

  handleTrusted('get-app-version', () => {
    return app.getVersion();
  });

  handleTrusted('get-local-ips', () => {
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

  handleTrusted('get-library-path', () => {
    return store.get('libraryPath') || '';
  });

  handleTrusted('get-storage-mode', () => {
    return store.get('storageMode') || 'local';
  });

  handleTrusted('get-s3-config', () => {
    const stored = readS3Config();
    if (!stored) return null;

    // Never hand the secret access key back to the renderer (F03). Book
    // content is rendered in the same renderer process, so anything the
    // renderer can read is within reach of a compromise there. The settings
    // form only needs to know whether a secret is already stored.
    return {
      bucket: stored.bucket,
      accessKey: stored.accessKey,
      endpoint: stored.endpoint,
      region: stored.region,
      prefix: stored.prefix,
      pollInterval: stored.pollInterval,
      secretKeyConfigured: hasStoredS3Secret(),
    };
  });

  handleTrusted('save-s3-config', async (_event, incoming: unknown) => {
    const parsed = parseS3ConfigInput(incoming);
    if ('error' in parsed) {
      return { success: false, error: parsed.error };
    }

    const existing = readS3Config();
    const next: S3Config = {
      ...parsed.config,
      // An empty secret means "keep the one already stored", which is what
      // the redacted form sends back when the owner has not retyped it.
      secretKey: parsed.config.secretKey || existing?.secretKey || '',
    };

    if (!next.secretKey) {
      return { success: false, error: 'A secret access key is required' };
    }

    const alreadyActive = store.get('storageMode') === 's3';
    if (alreadyActive && existing && s3ConfigsEqual(existing, next)) {
      // Saving unchanged settings must be a no-op. It used to clear the
      // entire books table — and with it everyone's reading progress and
      // collection membership — even when nothing had changed (F09).
      console.log('[Electron] S3 settings unchanged; nothing to do');
      return { success: true, unchanged: true };
    }

    // Prove the new configuration works *before* replacing a working one.
    const check = checkS3Connectivity(next);
    if (!check.ok) {
      console.error('[Electron] Rejected S3 settings that could not reach the bucket:', check.error);
      return {
        success: false,
        error: `Could not reach the bucket with these settings: ${check.error}`,
      };
    }

    const previousConfig = existing;
    const previousMode = store.get('storageMode');

    try {
      setS3Config(next);
      store.set('storageMode', 's3');

      if (watcherProcess) {
        watcherProcess.kill();
        watcherProcess = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Books are deliberately left in place. Switching source or rotating a
      // key is not a request to destroy reading state; the S3 scanner
      // reconciles the newly configured bucket/prefix, and "Clear library"
      // in Admin -> Library remains available as an explicit operation.
      const libraryPath = store.get('libraryPath') || '';
      await restartServer(libraryPath);
      startWatcher(libraryPath);

      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to activate S3 config; restoring the previous one:', error);
      if (previousConfig) {
        setS3Config(previousConfig);
      }
      store.set('storageMode', previousMode);
      return { success: false, error: String(error) };
    }
  });

  handleTrusted('switch-to-local-storage', async () => {
    try {
      store.set('storageMode', 'local');

      if (watcherProcess) {
        watcherProcess.kill();
        watcherProcess = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // As above: changing source does not delete reader state.
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

  handleTrusted('select-library-path-initial', async () => {
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

  handleTrusted('complete-onboarding', () => {
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

  handleTrusted('reset-app', async () => {
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

  handleTrusted('get-tunnel-status', () => {
    const enabled = store.get('tunnelEnabled');
    const subdomain = store.get('tunnelSubdomain');
    const url = subdomain ? `https://${subdomain}.${TUNNEL_DOMAIN}` : '';

    let hasRemoteCredentials = false;
    try {
      hasRemoteCredentials = countLoginCapableAccounts(store.get('libraryPath') || '') > 0;
    } catch {
      // Reported as "no credentials" rather than failing the status call.
    }

    return {
      enabled,
      subdomain,
      url,
      connected: tunnelProcess !== null,
      hasRemoteCredentials,
      ownershipClaimed: Boolean(store.get('tunnelSecret')),
    };
  });

  handleTrusted('enable-tunnel', () => {
    // Public access is only meaningful — and only safe — once the owner has
    // created an account that can actually log in. The desktop principal
    // deliberately cannot (F01), so without this check enabling the tunnel
    // would publish a login page with no usable credentials, and previously
    // published one whose password was a matter of public record.
    let loginCapable = 0;
    try {
      loginCapable = countLoginCapableAccounts(store.get('libraryPath') || '');
    } catch (error) {
      console.error('[Electron] Could not check for remote-capable accounts:', error);
      return { error: 'account-check-failed' };
    }

    if (loginCapable === 0) {
      return { error: 'no-remote-credentials' };
    }

    let subdomain = store.get('tunnelSubdomain');
    let secret = store.get('tunnelSecret');
    let rotated = false;

    if (!subdomain || !secret) {
      // A name carried over from before authenticated registration has no
      // proof of ownership, and the relay will not take our word for it.
      // Rotating is the only safe migration: anybody could have claimed the
      // old name in the meantime.
      if (subdomain && !secret) {
        console.warn(
          `[Electron] Rotating tunnel name "${subdomain}": it predates authenticated registration.`,
        );
        rotated = true;
      }
      subdomain = generateTunnelSubdomain();
      secret = randomBytes(32).toString('base64');
      store.setMany({ tunnelSubdomain: subdomain, tunnelSecret: secret, tunnelOwnershipVersion: 2 });
    }

    store.set('tunnelEnabled', true);
    startTunnel();
    const url = `https://${subdomain}.${TUNNEL_DOMAIN}`;
    return { subdomain, url, rotated };
  });

  handleTrusted('disable-tunnel', () => {
    store.set('tunnelEnabled', false);
    stopTunnel();
  });

  handleTrusted('regenerate-tunnel-subdomain', () => {
    // A new name needs a new ownership secret: reusing the old one would
    // leave the previous name claimable with a secret we still hold, and
    // would tie two public identities to one proof.
    const subdomain = generateTunnelSubdomain();
    const secret = randomBytes(32).toString('base64');
    store.setMany({ tunnelSubdomain: subdomain, tunnelSecret: secret, tunnelOwnershipVersion: 2 });

    // Restart tunnel if it was running
    if (store.get('tunnelEnabled')) {
      stopTunnel();
      startTunnel();
    }

    const url = `https://${subdomain}.${TUNNEL_DOMAIN}`;
    return { subdomain, url };
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
    } else if (!runMigrations(libraryPath)) {
      // Serving against a half-built schema is worse than not serving:
      // requests fail in unpredictable ways and, before this change, a
      // login could even take it upon itself to create an administrator.
      dialog.showErrorBox(
        'Database could not be prepared',
        'Alex could not apply its database migrations, so it will not start. '
          + 'Check the logs prefixed with [Electron] for the underlying error.',
      );
      app.exit(1);
      return;
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

    // Auto-start tunnel if enabled. A name with no ownership secret is
    // skipped rather than registered unauthenticated; the owner regenerates
    // the URL from Admin -> Users to claim a fresh, proven name.
    if (store.get('tunnelEnabled') && store.get('tunnelSubdomain')) {
      if (store.get('tunnelSecret')) {
        startTunnel();
      } else {
        console.warn(
          '[Electron] Public access is enabled but this tunnel name has no ownership secret. '
            + 'Open Admin -> Users and regenerate the public URL.',
        );
      }
    }

    createWindow();
  } else {
    // Dev mode: server is already running externally via concurrently
    console.log('[Electron] Dev mode: using external server');

    // Migrations are idempotent, so run them unconditionally rather than
    // only when the database file happens to be missing — that check meant
    // an existing database never picked up later migrations in dev.
    if (!isE2E && !runMigrations(libraryPath)) {
      dialog.showErrorBox(
        'Database could not be prepared',
        'Alex could not apply its database migrations. Check the logs prefixed with [Electron].',
      );
      app.exit(1);
      return;
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
