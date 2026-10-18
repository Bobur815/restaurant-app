import type { ElectronAPI } from '@shared/api';

declare global {
  interface Window {
    readonly electronAPI: ElectronAPI;
  }
}

export {};
