import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectLibraryPath: () => ipcRenderer.invoke('select-library-path'),
  rescanLibrary: () => ipcRenderer.invoke('rescan-library'),
  nukeAndRescanLibrary: () => ipcRenderer.invoke('nuke-and-rescan-library'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
