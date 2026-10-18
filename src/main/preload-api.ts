import {
  APP_EVENT_CHANNEL,
  APP_EVENT_TYPES,
  IPC_CHANNELS,
  splitChannel,
  type AppEvent,
  type ElectronAPI,
} from '@shared/ipc';

/** The slice of ipcRenderer the API needs; injected so the builder is testable without Electron. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

const isAppEvent = (value: unknown): value is AppEvent =>
  typeof value === 'object' &&
  value !== null &&
  (APP_EVENT_TYPES as readonly string[]).includes((value as { type?: unknown }).type as string);

/**
 * Builds window.electronAPI from the channel list: `orders:save` becomes `api.orders.save(input)`,
 * which invokes exactly that channel with one argument. Nothing else reaches ipcRenderer: no raw
 * invoke/send, no channel chosen by the page.
 */
export function createElectronApi(ipc: IpcRendererLike): ElectronAPI {
  const api: Record<string, Record<string, unknown>> = {};

  for (const channel of IPC_CHANNELS) {
    const [ns, method] = splitChannel(channel);
    (api[ns] ??= {})[method] = (input?: unknown) => ipc.invoke(channel, input);
  }

  api['events'] = {
    subscribe(listener: (event: AppEvent) => void): () => void {
      const wrapped = (_event: unknown, payload: unknown) => {
        if (isAppEvent(payload)) listener(payload);
      };
      ipc.on(APP_EVENT_CHANNEL, wrapped);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        ipc.removeListener(APP_EVENT_CHANNEL, wrapped);
      };
    },
  };

  return api as unknown as ElectronAPI;
}
