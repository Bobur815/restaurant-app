import { createApiClient, type ApiError } from '@shared/api-client';

export { ApiError, isApiError } from '@shared/api-client';
export type { AppEvent } from '@shared/ipc';

type ErrorListener = (error: ApiError) => void;
const errorListeners = new Set<ErrorListener>();

/** Global failure hook (the router uses it to send NOT_AUTHENTICATED back to login). */
export function onApiError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

/**
 * The renderer's only door to the main process (lint forbids window.electronAPI elsewhere).
 * Every call resolves to its data or throws ApiError:
 *
 *   const order = await api.orders.save({ tableNumber: 3, lines, expectedVersion });
 *   const stop = api.events.subscribe((e) => { if (e.type === 'orders-changed') reload(); });
 */
export const api = createApiClient(window.electronAPI, {
  onError: (error) => errorListeners.forEach((l) => l(error)),
});
