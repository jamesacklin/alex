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
 * What the main process is willing to tell the renderer about the stored S3
 * settings.
 *
 * The secret access key is deliberately absent: book content renders in this
 * same renderer, so anything the renderer can read is within reach of a
 * compromise there. `secretKeyConfigured` is enough for the settings form,
 * which sends an empty `secretKey` to mean "keep the stored one".
 */
export interface RedactedS3Config extends Omit<S3Config, 'secretKey'> {
  secretKeyConfigured: boolean;
}

export interface TunnelStatus {
  enabled: boolean;
  subdomain: string;
  url: string;
  connected: boolean;
  /** True when at least one account can log in over the network. */
  hasRemoteCredentials: boolean;
  /** True when this installation holds the relay ownership proof for its name. */
  ownershipClaimed: boolean;
}

export type EnableTunnelResult =
  | { subdomain: string; url: string; rotated: boolean }
  | { error: 'no-remote-credentials' | 'account-check-failed' };

export interface ElectronAPI {
  selectLibraryPath: () => Promise<string | null>;
  selectLibraryPathInitial: () => Promise<string | null>;
  completeOnboarding: () => Promise<{ success: boolean; error?: string }>;
  resetApp: () => Promise<{ success: boolean }>;
  rescanLibrary: () => Promise<boolean>;
  nukeAndRescanLibrary: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getLibraryPath: () => Promise<string>;
  getStorageMode: () => Promise<'local' | 's3'>;
  getLocalIps: () => Promise<string[]>;
  getS3Config: () => Promise<RedactedS3Config | null>;
  saveS3Config: (
    config: Omit<S3Config, 'secretKey'> & { secretKey: string },
  ) => Promise<{ success: boolean; error?: string; unchanged?: boolean }>;
  switchToLocalStorage: () => Promise<{ success: boolean; error?: string }>;
  getTunnelStatus: () => Promise<TunnelStatus>;
  enableTunnel: () => Promise<EnableTunnelResult>;
  disableTunnel: () => Promise<void>;
  regenerateTunnelSubdomain: () => Promise<{ subdomain: string; url: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
