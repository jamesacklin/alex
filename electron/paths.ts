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

  // Ensure directories exist
  if (!fs.existsSync(baseDataPath)) {
    fs.mkdirSync(baseDataPath, { recursive: true });
  }

  if (!fs.existsSync(coversPath)) {
    fs.mkdirSync(coversPath, { recursive: true });
  }

  if (libraryPath && !fs.existsSync(libraryPath)) {
    fs.mkdirSync(libraryPath, { recursive: true });
  }

  return {
    databasePath,
    coversPath,
    libraryPath,
  };
}
