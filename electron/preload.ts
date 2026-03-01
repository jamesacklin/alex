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
  getStorageMode: () => ipcRenderer.invoke('get-storage-mode'),
  getLocalIps: () => ipcRenderer.invoke('get-local-ips'),
  getS3Config: () => ipcRenderer.invoke('get-s3-config'),
  saveS3Config: (config: Record<string, unknown>) => ipcRenderer.invoke('save-s3-config', config),
  switchToLocalStorage: () => ipcRenderer.invoke('switch-to-local-storage'),
  getTunnelStatus: () => ipcRenderer.invoke('get-tunnel-status'),
  enableTunnel: () => ipcRenderer.invoke('enable-tunnel'),
  disableTunnel: () => ipcRenderer.invoke('disable-tunnel'),
  regenerateTunnelSubdomain: () => ipcRenderer.invoke('regenerate-tunnel-subdomain'),
});
