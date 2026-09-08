import { app, safeStorage } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface S3Config {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix?: string;
  pollInterval?: number;
}

/**
 * On-disk shape of an S3 config.
 *
 * The secret access key is held in `secretKeyEnc` — an OS-keychain-encrypted
 * blob produced by Electron's `safeStorage` — whenever encryption is
 * available on the platform. `secretKey` remains for the plaintext fallback
 * and to read configs written by older versions, which are re-encrypted the
 * first time they are loaded.
 */
interface StoredS3Config extends Omit<S3Config, 'secretKey'> {
  secretKey?: string;
  secretKeyEnc?: string;
}

interface StoreSchema {
  libraryPath: string;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  nextauthSecret: string;
  storageMode: 'local' | 's3';
  s3Config?: StoredS3Config;
  tunnelEnabled: boolean;
  tunnelSubdomain: string;
  /**
   * Secret proving ownership of `tunnelSubdomain` to the relay, base64.
   * Absent for names claimed before authenticated registration existed;
   * those names are rotated rather than trusted (see F02).
   */
  tunnelSecret: string;
  /** Protocol version the current tunnel name was claimed under. */
  tunnelOwnershipVersion: number;
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

const DEFAULT_STORE: StoreSchema = {
  libraryPath: '',
  nextauthSecret: generateSecret(),
  storageMode: 'local',
  tunnelEnabled: false,
  tunnelSubdomain: '',
  tunnelSecret: '',
  tunnelOwnershipVersion: 0,
};

const explicitUserDataPath = process.env.E2E_USER_DATA_DIR || process.env.ALEX_USER_DATA_DIR;
const resolvedUserDataPath = explicitUserDataPath || app.getPath('userData');
const storePath = path.join(resolvedUserDataPath, 'config.json');

/**
 * Write the config atomically.
 *
 * A partial write leaves the desktop app with no library path, no NextAuth
 * secret and no tunnel ownership proof, which is a worse outcome than the
 * write simply failing. Writing to a sibling temp file and renaming makes
 * the swap atomic on every platform we ship.
 */
function writeStore(data: StoreSchema): void {
  const storeDir = path.dirname(storePath);
  fs.mkdirSync(storeDir, { recursive: true });

  const tempPath = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, storePath);
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
  /** Apply several fields and persist once, so the file is never half-updated. */
  setMany(values: Partial<StoreSchema>): void {
    Object.assign(state, values);
    writeStore(state);
  },
};

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Persist an S3 config, encrypting the secret access key with the OS
 * keychain when the platform supports it.
 */
export function setS3Config(config: S3Config): void {
  const { secretKey, ...rest } = config;
  const stored: StoredS3Config = { ...rest };

  if (secretKey && encryptionAvailable()) {
    try {
      stored.secretKeyEnc = safeStorage.encryptString(secretKey).toString('base64');
    } catch (error) {
      console.error('[Electron] safeStorage encryption failed; storing the S3 secret in plain text', error);
      stored.secretKey = secretKey;
    }
  } else if (secretKey) {
    stored.secretKey = secretKey;
  }

  store.set('s3Config', stored);
}

/** Read the S3 config with its secret decrypted, or null when unset. */
export function getS3Config(): S3Config | null {
  const stored = store.get('s3Config');
  if (!stored) return null;

  let secretKey = stored.secretKey ?? '';
  if (stored.secretKeyEnc) {
    try {
      secretKey = safeStorage.decryptString(Buffer.from(stored.secretKeyEnc, 'base64'));
    } catch (error) {
      console.error('[Electron] Failed to decrypt the stored S3 secret', error);
      secretKey = '';
    }
  }

  return { ...stored, secretKey } as S3Config;
}

/** True when a secret is stored, without revealing it. */
export function hasStoredS3Secret(): boolean {
  const stored = store.get('s3Config');
  return Boolean(stored?.secretKeyEnc || stored?.secretKey);
}

/**
 * Re-encrypt a plaintext secret written by an older version.
 * Called once at startup; a no-op when there is nothing to migrate.
 */
export function migrateS3SecretToKeychain(): void {
  const stored = store.get('s3Config');
  if (!stored?.secretKey || stored.secretKeyEnc || !encryptionAvailable()) {
    return;
  }

  console.log('[Electron] Moving the stored S3 secret into OS keychain storage');
  setS3Config({ ...stored, secretKey: stored.secretKey } as S3Config);
}
