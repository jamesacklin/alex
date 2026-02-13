import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectLibraryPath: () => ipcRenderer.invoke('select-library-path'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
