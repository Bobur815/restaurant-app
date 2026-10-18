import type { Prisma, PrismaClient } from '../../generated/prisma-sqlite';
import type { CurrentUser } from '@shared/types';
import { dec, type DecimalString } from '@shared/utils/decimal';

/** The database handle domain modules receive (never imported as a singleton). */
export type Db = PrismaClient;
/** A client inside `db.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;
/** Either: functions that only read or that must join the caller's transaction take this. */
export type DbOrTx = Db | Tx;

/** Who is calling: from the window's login (IPC) or, later, the device token (LAN). */
export type Actor = CurrentUser;

/** Prisma.Decimal (or null) → DecimalString for DTOs. */
export function decStr(value: { toString(): string }): DecimalString;
export function decStr(value: { toString(): string } | null): DecimalString | null;
export function decStr(value: { toString(): string } | null): DecimalString | null {
  return value === null ? null : dec(value.toString()).toFixed();
}

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Local-time day bounds for YYYY-MM-DD filters (the till's clock is the business clock). */
export function dayStart(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
export function dayEnd(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
/** YYYY-MM-DD of a moment, in local time. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
