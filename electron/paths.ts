import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface DataPaths {
  databasePath: string;
  coversPath: string;
  libraryPath: string;
}

export function getDataPaths(libraryPath: string): DataPaths {
  const userDataPath = app.getPath('userData');

  const databasePath = path.join(userDataPath, 'library.db');
  const coversPath = path.join(userDataPath, 'covers');

  // Ensure directories exist
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
