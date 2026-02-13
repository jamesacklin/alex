export interface ElectronAPI {
  selectLibraryPath: () => Promise<string | null>;
  getAppVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
