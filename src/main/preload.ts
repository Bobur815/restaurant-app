import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ElectronAPI } from '@shared/api';

// Runs with sandbox: true, so only `electron` is requirable here; everything else is bundled in.
// Never expose ipcRenderer itself: the renderer gets named functions and nothing more.
const api: ElectronAPI = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
