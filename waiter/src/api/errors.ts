import type { ErrorCode, IpcError } from '@shared/errors';

/**
 * A refused or failed call. `code` is main's (`CONFLICT`, `VALIDATION`, `LOCKED`, ...) or one of
 * the phone's own: `OFFLINE` (no answer), `UNPAIRED` (the till no longer knows this phone),
 * `LIMIT` (the plan's phones are all taken). The message is main's Uzbek text where there is one.
 */
export type PhoneErrorCode = ErrorCode | 'OFFLINE' | 'UNPAIRED' | 'LIMIT';

export class ApiError extends Error {
  constructor(
    readonly code: PhoneErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static from(e: IpcError): ApiError {
    return new ApiError(e.code, e.message, e.details as Record<string, unknown> | undefined);
  }
}

export const isApiError = (e: unknown, code?: PhoneErrorCode): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

/** One row of a stock shortage (orders:save CONFLICT `details.shortages`). */
export interface Shortage {
  menuItemId: number;
  nameUz: string;
  requested?: string;
  remaining?: string;
  reason: 'INSUFFICIENT' | 'NOT_IN_SESSION' | string;
}

export function shortagesOf(e: unknown): Shortage[] | null {
  if (!isApiError(e, 'CONFLICT')) return null;
  const list = e.details?.['shortages'];
  return Array.isArray(list) && list.length > 0 ? (list as Shortage[]) : null;
}

/** The version check failed: someone else changed the order since it was loaded. */
export function isVersionConflict(e: unknown): boolean {
  if (!isApiError(e, 'CONFLICT')) return false;
  return e.details?.['reason'] === 'STALE';
}
