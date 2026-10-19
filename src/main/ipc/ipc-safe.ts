import { ZodError, type z } from 'zod';
import type { IpcError, IpcResult } from '@shared/errors';
import type { IpcChannel, IpcOutput } from '@shared/ipc';
import { refreshActor } from '../auth/auth';
import type { Actor, Db } from '../domain/db';
import { AppError, forbidden, notAuthenticated, prismaCode } from '../domain/errors';
import { ImageImportError } from '../images/image-store';
import type { PrinterService } from '../printing/printer';

/**
 * Who may call a handler: `public` (setup, login, settings for the login screen), `user` (any
 * logged-in role), `admin`. Checked here, in main, on every call; hiding buttons in the UI is
 * cosmetic only.
 */
export type Access = 'public' | 'user' | 'admin';

/** Side effects a handler may need that are not the database (dialogs, files). Injected for tests. */
export interface HandlerServices {
  appInfo(): { name: string; version: string; isPackaged: boolean };
  printer: PrinterService;
  pickImage(): Promise<string | null>;
}

export interface HandlerContext {
  db: Db;
  /** The caller's logged-in user (per window over IPC, per device token over LAN later). */
  actor: Actor | null;
  setActor(actor: Actor | null): void;
  services: HandlerServices;
  log(message: string, error?: unknown): void;
}

export interface HandlerDef<C extends IpcChannel, Schema extends z.ZodType = z.ZodType> {
  access: Access;
  input: Schema;
  run(ctx: HandlerContext & { actor: Actor }, input: z.output<Schema>): Promise<IpcOutput<C>>;
}

export interface PublicHandlerDef<C extends IpcChannel, Schema extends z.ZodType = z.ZodType> {
  access: 'public';
  input: Schema;
  run(ctx: HandlerContext, input: z.output<Schema>): Promise<IpcOutput<C>>;
}

export type AnyHandlerDef<C extends IpcChannel> = HandlerDef<C> | PublicHandlerDef<C>;

const INTERNAL_MESSAGE = "Kutilmagan xatolik. Qayta urinib ko'ring";

/** Turns anything thrown into an IpcError. Unknown errors are logged, never sent. */
export function toIpcError(error: unknown, log: HandlerContext['log'], channel: string): IpcError {
  if (error instanceof AppError) return error.toIpc();
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION',
      message: error.issues[0]?.message ?? "Ma'lumot noto'g'ri",
      details: {
        issues: error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      },
    };
  }
  if (error instanceof ImageImportError) return { code: 'VALIDATION', message: error.message };

  switch (prismaCode(error)) {
    case 'P2002':
      return { code: 'CONFLICT', message: 'Bunday yozuv allaqachon bor' };
    case 'P2003':
    case 'P2014':
      return { code: 'CONFLICT', message: "Bog'liq yozuvlar bor" };
    case 'P2025':
      return { code: 'NOT_FOUND', message: 'Yozuv topilmadi' };
  }

  log(`[ipc] ${channel} failed`, error);
  return { code: 'INTERNAL', message: INTERNAL_MESSAGE };
}

/**
 * Runs one handler: access check (re-reading the user, so a deactivated account is cut off on its
 * next action), input parsing, then the handler. Never throws: every outcome is an IpcResult.
 */
export async function invokeHandler<C extends IpcChannel>(
  channel: C,
  def: AnyHandlerDef<C>,
  ctx: HandlerContext,
  rawInput: unknown,
): Promise<IpcResult<IpcOutput<C>>> {
  try {
    let actor = ctx.actor;
    if (def.access !== 'public') {
      actor = actor ? await refreshActor(ctx.db, actor) : null;
      if (!actor) {
        ctx.setActor(null);
        throw notAuthenticated();
      }
      if (def.access === 'admin' && actor.role !== 'ADMIN') throw forbidden();
    }

    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) throw parsed.error;

    const data = await (def.run as (c: HandlerContext, i: unknown) => Promise<IpcOutput<C>>)(
      { ...ctx, actor },
      parsed.data,
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toIpcError(error, ctx.log, channel) };
  }
}
