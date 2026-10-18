import { contextBridge, ipcRenderer } from 'electron';
import { createElectronApi } from './preload-api';

// Runs with sandbox: true, so only `electron` is requirable here; everything else is bundled in.
// The page gets named functions per channel and an event subscription, never ipcRenderer.
contextBridge.exposeInMainWorld('electronAPI', createElectronApi(ipcRenderer));
