/**
 * Error codes every handler can return. The renderer switches on `code` (and translates it);
 * `message` is a ready-to-show Uzbek fallback.
 */
export const ERROR_CODES = [
  'NOT_AUTHENTICATED', // no user logged in on this window/device
  'FORBIDDEN', // logged in, but the role does not allow it
  'VALIDATION', // input failed the schema or a business rule about its shape
  'NOT_FOUND',
  'CONFLICT', // state does not allow it: duplicate, stale version, open shift exists, in use...
  'LOCKED', // login throttled after repeated failures
  'INTERNAL', // bug or I/O failure; details are logged in main, never sent
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface IpcError {
  code: ErrorCode;
  message: string;
  /** Structured, safe-to-show details (e.g. which field, which dishes are short). */
  details?: unknown;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };
