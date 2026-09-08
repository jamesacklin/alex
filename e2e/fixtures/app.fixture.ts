/* eslint-disable react-hooks/rules-of-hooks */
// Playwright's fixture `use()` function is not a React hook
import { test as base, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from 'net';

type AppFixture = {
  appPage: Page;
  electronApp: ElectronApplication | null;
};

const E2E_ELECTRON_PORT = 3210;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForPortToBeFree(port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function killPortListeners(port: number) {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      execSync(`lsof -ti:tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
      return;
    }
    if (process.platform === 'win32') {
      execSync(`FOR /F "tokens=5" %P IN ('netstat -a -n -o ^| findstr :${port}') DO TaskKill.exe /F /PID %P 2>nul || exit 0`, { stdio: 'ignore' });
    }
  } catch {
    // Ignore cleanup errors.
  }
}

function forceKillProcessTree(pid: number) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      return;
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // Process may already be gone.
  }
}

async function waitForRouteReady(url: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(requestTimeout);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for ${url}. Last error: ${String(lastError)}`);
}

/**
 * Wait for the main window.
 *
 * The window is created only after the app's own `waitForServerReady`
 * resolves, and that has a 120s budget in E2E mode. A 30s budget here was
 * therefore shorter than the thing it was waiting on, so a slow-but-healthy
 * cold start was reported as a failure to create a window. The budget now
 * covers the app's, and the diagnosis on expiry says whether the app was
 * still waiting for its server or had given up.
 */
async function waitForElectronWindow(
  electronApp: ElectronApplication,
  timeoutMs = Number(process.env.E2E_WINDOW_TIMEOUT_MS) || 150_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const windowCount = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    if (windowCount > 0) {
      return;
    }

    const electronProcess = electronApp.process();
    if (electronProcess.exitCode !== null) {
      throw new Error(`Electron process exited before creating a window (exit code ${electronProcess.exitCode})`);
    }

    await sleep(250);
  }

  const serverReachable = !(await isPortFree(E2E_ELECTRON_PORT));
  throw new Error(
    `Timed out waiting ${timeoutMs}ms for Electron window creation. `
      + `The app's HTTP server was ${serverReachable ? 'listening' : 'NOT listening'} on port ${E2E_ELECTRON_PORT}, `
      + `so the app was ${serverReachable ? 'past' : 'probably still inside'} waitForServerReady(). `
      + 'Look for [Electron] lines above.',
  );
}

export const test = base.extend<AppFixture>({
  electronApp: async ({ context }, use) => {
    void context;

    if (process.env.E2E_PLATFORM !== 'electron') {
      await use(null);
      return;
    }

    const testUserDataDir = path.join(process.cwd(), '.e2e-user-data');
    const testLibraryPath = path.join(process.cwd(), '.e2e-library');

    console.log('[Fixture] Setting up Electron test environment');
    console.log('[Fixture] User data dir:', testUserDataDir);
    console.log('[Fixture] Library path:', testLibraryPath);

    // Ensure Electron's Next.js port is free before launching.
    let portIsFree = await waitForPortToBeFree(E2E_ELECTRON_PORT, 10_000);
    if (!portIsFree) {
      console.warn(`[Fixture] Port ${E2E_ELECTRON_PORT} still in use, attempting forced cleanup...`);
      killPortListeners(E2E_ELECTRON_PORT);
      portIsFree = await waitForPortToBeFree(E2E_ELECTRON_PORT, 10_000);
    }
    if (!portIsFree) {
      throw new Error(`Port ${E2E_ELECTRON_PORT} is still in use before Electron launch`);
    }

    const electronEntry = path.join(process.cwd(), 'electron', 'dist', 'main.js');
    if (!fs.existsSync(electronEntry)) {
      console.log('[Fixture] Electron dist missing, compiling main process...');
      execSync('pnpm electron:compile', { stdio: 'inherit' });
    }

    fs.mkdirSync(testUserDataDir, { recursive: true });
    fs.mkdirSync(testLibraryPath, { recursive: true });

    const configPath = path.join(testUserDataDir, 'config.json');
    const storeConfig = {
      libraryPath: testLibraryPath,
      nextauthSecret: process.env.NEXTAUTH_SECRET || 'e2e-test-secret-do-not-use-in-production',
    };
    fs.writeFileSync(configPath, JSON.stringify(storeConfig, null, 2), 'utf8');
    console.log('[Fixture] Created Electron store config');

    // CI runners (Linux) lack the SUID sandbox binary; disable it there.
    const launchArgs = [electronEntry, `--user-data-dir=${testUserDataDir}`];
    if (process.env.CI) {
      launchArgs.push('--no-sandbox');
      // Avoid noisy GPU process initialization failures in headless/Xvfb CI.
      launchArgs.push('--disable-gpu');
      launchArgs.push('--disable-dev-shm-usage');
      if (process.env.E2E_USE_SWIFTSHADER === '1') {
        launchArgs.push('--use-gl=swiftshader');
      }
    }

    const app = await electron.launch({
      args: launchArgs,
      env: {
        ...process.env,
        ALEX_E2E: 'true',
        E2E_USER_DATA_DIR: testUserDataDir,
        DATABASE_PATH: path.join(process.cwd(), 'data/library.db'),
        LIBRARY_PATH: testLibraryPath,
      },
      timeout: 60000,
    });

    const electronProcess = app.process();
    const logElectronProcess = process.env.E2E_DEBUG_ELECTRON === '1';
    const onStdout = (chunk: Buffer) => process.stdout.write(`[Electron stdout] ${chunk.toString()}`);
    const onStderr = (chunk: Buffer) => process.stderr.write(`[Electron stderr] ${chunk.toString()}`);

    // The main process's own diagnostics — every `[Electron] ...` line, and
    // anything from the Next.js child that looks like a failure — go to
    // stdout, which CI used to discard entirely. That is why a startup
    // failure here showed up only as "no window appeared", with no reason.
    //
    // Full stdout is still not forwarded in CI: the Next.js server is
    // verbose enough to OOM the Playwright worker. Instead, interesting
    // lines are printed as they arrive and a bounded tail is kept so it can
    // be dumped if startup fails.
    const INTERESTING = /^\[(Electron|Tunnel)\]|error|Error|EADDRINUSE|ECONNREFUSED|failed|FATAL/;
    const TAIL_LIMIT = 200;
    const tail: string[] = [];
    let stdoutRemainder = '';

    const onCiStdout = (chunk: Buffer) => {
      const lines = (stdoutRemainder + chunk.toString()).split('\n');
      stdoutRemainder = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        tail.push(line);
        if (tail.length > TAIL_LIMIT) tail.shift();
        if (INTERESTING.test(line)) process.stdout.write(`[Electron stdout] ${line}\n`);
      }
    };

    const dumpTail = (reason: string) => {
      if (tail.length === 0) return;
      process.stdout.write(`[Fixture] --- last ${tail.length} Electron stdout line(s) (${reason}) ---\n`);
      for (const line of tail) process.stdout.write(`[Electron stdout] ${line}\n`);
      process.stdout.write('[Fixture] --- end Electron stdout ---\n');
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      console.log(`[Fixture] Electron process exited (code=${code}, signal=${signal})`);
      if (code !== 0 && code !== null) dumpTail(`exit code ${code}`);
    };

    if (logElectronProcess) {
      electronProcess.stdout?.on('data', onStdout);
      electronProcess.stderr?.on('data', onStderr);
    } else if (process.env.CI) {
      electronProcess.stdout?.on('data', onCiStdout);
      electronProcess.stderr?.on('data', onStderr);
    }
    electronProcess.on('exit', onExit);

    try {
      await use(app);
    } finally {
      if (logElectronProcess) {
        electronProcess.stdout?.off('data', onStdout);
        electronProcess.stderr?.off('data', onStderr);
      }
      electronProcess.off('exit', onExit);

      console.log('[Fixture] Closing Electron app...');
      const closePromise = app.close().then(
        () => true,
        (error) => {
        console.warn('[Fixture] app.close() rejected:', error);
          return false;
        },
      );
      const closeTimeoutMs = process.env.CI ? 1_500 : 4_000;
      const postKillCloseTimeoutMs = process.env.CI ? 1_000 : 2_000;
      let closeCompleted = await Promise.race<boolean>([
        closePromise,
        sleep(closeTimeoutMs).then(() => false),
      ]);

      if (!closeCompleted && electronProcess.pid != null) {
        console.warn(`[Fixture] app.close() timed out, force-killing process tree (pid=${electronProcess.pid})`);
        forceKillProcessTree(electronProcess.pid);
        closeCompleted = await Promise.race<boolean>([
          closePromise,
          sleep(postKillCloseTimeoutMs).then(() => false),
        ]);
      }

      if (!closeCompleted) {
        console.warn('[Fixture] Electron shutdown did not complete after force-kill timeout; continuing cleanup');
      }

      let released = await waitForPortToBeFree(E2E_ELECTRON_PORT, 10_000);
      if (!released) {
        console.warn(`[Fixture] Port ${E2E_ELECTRON_PORT} still in use after close, forcing cleanup...`);
        killPortListeners(E2E_ELECTRON_PORT);
        released = await waitForPortToBeFree(E2E_ELECTRON_PORT, 10_000);
      }
      if (!released) {
        console.warn(`[Fixture] Port ${E2E_ELECTRON_PORT} remained busy after cleanup attempts`);
      }

      fs.rmSync(testUserDataDir, { recursive: true, force: true });
      fs.rmSync(testLibraryPath, { recursive: true, force: true });
    }
  },

  appPage: async ({ page, electronApp }, use) => {
    if (process.env.E2E_PLATFORM === 'electron') {
      if (!electronApp) {
        throw new Error('electronApp fixture was not initialized');
      }

      const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3210';
      // The default Playwright page is a separate Chromium client and can race
      // the real Electron window; close it in desktop mode.
      try {
        await page.close();
      } catch {
        // Ignore if already closed.
      }

      console.log('[Fixture] Waiting for Electron BrowserWindow...');
      await waitForElectronWindow(electronApp);
      const electronPage = await electronApp.firstWindow();
      await electronPage.bringToFront();
      console.log('[Fixture] Electron window found, waiting for route readiness...');
      await waitForRouteReady(`${baseUrl}/login`);
      console.log('[Fixture] Route ready, navigating appPage to stable desktop route...');
      await electronPage.goto(`${baseUrl}/library`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await electronPage.waitForURL(
        (url) => url.pathname === '/library' || url.pathname === '/onboarding',
        { timeout: 30000 },
      );
      await use(electronPage);
      return;
    }

    await page.goto((process.env.BASE_URL ?? 'http://localhost:3000') + '/login', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
