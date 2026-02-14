export interface ElectronAPI {
  selectLibraryPath: () => Promise<string | null>;
  selectLibraryPathInitial: () => Promise<string | null>;
  completeOnboarding: () => Promise<{ success: boolean; error?: string }>;
  resetApp: () => Promise<{ success: boolean }>;
  rescanLibrary: () => Promise<boolean>;
  nukeAndRescanLibrary: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getLibraryPath: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
