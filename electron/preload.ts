import { contextBridge } from 'electron';

// IPC bridge - to be populated in later phases
contextBridge.exposeInMainWorld('electronAPI', {});
