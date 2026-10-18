import type { ElectronAPI } from '@shared/ipc';

declare global {
  interface Window {
    readonly electronAPI: ElectronAPI;
  }
}

export {};
