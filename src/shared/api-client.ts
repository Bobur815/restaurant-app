import type { ErrorCode, IpcError, IpcResult } from './errors';
import {
  IPC_CHANNELS,
  splitChannel,
  type AppEvent,
  type CallFn,
  type ChannelOf,
  type ElectronAPI,
  type IpcMethod,
  type IpcNamespace,
  type IpcOutput,
} from './ipc';

/** A failed call, thrown by the API client. `code` drives the UI; `message` is the fallback text. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(
    readonly channel: string,
    error: IpcError,
  ) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details;
  }
}

export const isApiError = (e: unknown, code?: ErrorCode): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

/** Same namespaces and methods as ElectronAPI, but resolving to the data or throwing ApiError. */
export type ApiClient = {
  [NS in IpcNamespace]: {
    [M in IpcMethod<NS>]: CallFn<ChannelOf<NS, M>, IpcOutput<ChannelOf<NS, M>>>;
  };
} & {
  events: { subscribe(listener: (event: AppEvent) => void): () => void };
};

export interface ApiClientOptions {
  /** Called for every failure before it is thrown (e.g. NOT_AUTHENTICATED -> back to login). */
  onError?: (error: ApiError) => void;
}

/**
 * Wraps window.electronAPI: same calls, unwrapped. DOM-free so it is tested in node; the renderer
 * creates the single instance in src/renderer/api.
 */
export function createApiClient(
  electronAPI: ElectronAPI,
  options: ApiClientOptions = {},
): ApiClient {
  const client: Record<string, Record<string, unknown>> = {};
  const raw = electronAPI as unknown as Record<
    string,
    Record<string, (input?: unknown) => Promise<IpcResult<unknown>>>
  >;

  for (const channel of IPC_CHANNELS) {
    const [ns, method] = splitChannel(channel);
    (client[ns] ??= {})[method] = async (input?: unknown) => {
      const call = raw[ns]?.[method];
      if (!call) throw new ApiError(channel, { code: 'INTERNAL', message: 'API mavjud emas' });
      const result = await call(input);
      if (result.ok) return result.data;
      const error = new ApiError(channel, result.error);
      options.onError?.(error);
      throw error;
    };
  }
  client['events'] = {
    subscribe: (listener: (e: AppEvent) => void) => electronAPI.events.subscribe(listener),
  };

  return client as unknown as ApiClient;
}
