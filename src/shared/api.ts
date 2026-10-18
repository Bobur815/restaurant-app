/**
 * The surface preload exposes as `window.electronAPI`.
 *
 * Phase 1 placeholder: one channel to prove the main → preload → renderer chain under
 * `sandbox: true`. Phase 4 replaces this with the typed channel map in `shared/ipc.ts`.
 */
export const IPC = {
  appInfo: 'app:info',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  isPackaged: boolean;
}

export interface ElectronAPI {
  app: {
    info(): Promise<AppInfo>;
  };
}
