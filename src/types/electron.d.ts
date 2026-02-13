export interface ElectronAPI {
  selectLibraryPath: () => Promise<string | null>;
  rescanLibrary: () => Promise<boolean>;
  nukeAndRescanLibrary: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
