export interface S3Config {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix?: string;
  pollInterval?: number;
}

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
  getS3Config: () => Promise<S3Config | null>;
  saveS3Config: (config: S3Config) => Promise<{ success: boolean; error?: string }>;
  switchToLocalStorage: () => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
