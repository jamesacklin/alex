import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface DataPaths {
  databasePath: string;
  coversPath: string;
  libraryPath: string;
}

export function getDataPaths(libraryPath: string): DataPaths {
  const isDev = !app.isPackaged;

  // In dev mode, use project's data directory; in production, use Electron's userData
  const baseDataPath = isDev
    ? path.join(process.cwd(), 'data')
    : app.getPath('userData');

  const databasePath = path.join(baseDataPath, 'library.db');
  const coversPath = path.join(baseDataPath, 'covers');

  // Ensure our own directories exist
  if (!fs.existsSync(baseDataPath)) {
    fs.mkdirSync(baseDataPath, { recursive: true });
  }

  if (!fs.existsSync(coversPath)) {
    fs.mkdirSync(coversPath, { recursive: true });
  }

  // The library path is the owner's chosen folder, not ours to create.
  //
  // This used to `mkdirSync` it when absent, which turned an unmounted
  // external volume into an empty directory at the mountpoint — exactly the
  // state the scanner then reads as "every book was deleted" (F09). Leaving
  // it absent lets the watcher tell "the source is unavailable" apart from
  // "the source is empty".
  if (libraryPath && !fs.existsSync(libraryPath)) {
    console.warn(
      `[Electron] Configured library path is not present: ${libraryPath}. ` +
        'Leaving it alone — an absent path is treated as an unavailable source, not an empty one.',
    );
  }

  return {
    databasePath,
    coversPath,
    libraryPath,
  };
}

/** True when a configured library path is currently reachable. */
export function isLibraryPathAvailable(libraryPath: string): boolean {
  if (!libraryPath) return false;
  try {
    return fs.statSync(libraryPath).isDirectory();
  } catch {
    return false;
  }
}
