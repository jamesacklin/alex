import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

const DEFAULT_STORE: StoreSchema = {
  libraryPath: '',
  nextauthSecret: generateSecret(),
};

const storePath = path.join(app.getPath('userData'), 'config.json');

function writeStore(data: StoreSchema): void {
  const storeDir = path.dirname(storePath);
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

function readStore(): StoreSchema {
  try {
    if (!fs.existsSync(storePath)) {
      writeStore(DEFAULT_STORE);
      return { ...DEFAULT_STORE };
    }

    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreSchema>;
    const merged: StoreSchema = {
      ...DEFAULT_STORE,
      ...parsed,
    };

    if (!merged.nextauthSecret) {
      merged.nextauthSecret = generateSecret();
      writeStore(merged);
    }

    return merged;
  } catch {
    // Fallback to defaults if the file is unreadable/corrupt.
    writeStore(DEFAULT_STORE);
    return { ...DEFAULT_STORE };
  }
}

const state: StoreSchema = readStore();

export const store = {
  get<Key extends keyof StoreSchema>(key: Key): StoreSchema[Key] {
    return state[key];
  },
  set<Key extends keyof StoreSchema>(key: Key, value: StoreSchema[Key]): void {
    state[key] = value;
    writeStore(state);
  },
};
