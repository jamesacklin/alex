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

interface StoreApi {
  get<Key extends keyof StoreSchema>(key: Key): StoreSchema[Key];
  set<Key extends keyof StoreSchema>(key: Key, value: StoreSchema[Key]): void;
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// electron-store's inherited Conf methods are not visible with this tsconfig's moduleResolution.
export const store = new Store<StoreSchema>({
  defaults: {
    libraryPath: '',
    nextauthSecret: generateSecret(),
  },
}) as unknown as StoreApi;
