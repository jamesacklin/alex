import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectLibraryPath: () => ipcRenderer.invoke('select-library-path'),
  selectLibraryPathInitial: () => ipcRenderer.invoke('select-library-path-initial'),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),
  resetApp: () => ipcRenderer.invoke('reset-app'),
  rescanLibrary: () => ipcRenderer.invoke('rescan-library'),
  nukeAndRescanLibrary: () => ipcRenderer.invoke('nuke-and-rescan-library'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getLibraryPath: () => ipcRenderer.invoke('get-library-path'),
});
