import type { ErrorCode, IpcError } from '@shared/errors';

/** An expected failure with a code the renderer handles. Anything else becomes INTERNAL. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toIpc(): IpcError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} topilmadi`);
export const conflict = (message: string, details?: unknown) =>
  new AppError('CONFLICT', message, details);
export const invalid = (message: string, details?: unknown) =>
  new AppError('VALIDATION', message, details);
export const forbidden = (message = "Bu amal uchun ruxsat yo'q") =>
  new AppError('FORBIDDEN', message);
export const notAuthenticated = () => new AppError('NOT_AUTHENTICATED', 'Avval tizimga kiring');

/** Prisma known request error, without importing Prisma's runtime. */
export function prismaCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined;
}

export const isUniqueViolation = (error: unknown) => prismaCode(error) === 'P2002';
