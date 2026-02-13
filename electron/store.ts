import Store from 'electron-store';
import * as crypto from 'crypto';

interface StoreSchema {
  libraryPath: string;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  nextauthSecret: string;
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Using 'as any' to work around TypeScript resolution issues with electron-store
export const store = new Store<StoreSchema>({
  defaults: {
    libraryPath: '',
    nextauthSecret: generateSecret(),
  },
}) as any;
