import { TABLE_LOCK_LEASE_MS } from '@shared/table-lock';
import type { TableLockDto } from '@shared/types';
import { conflict } from '../domain/errors';

/**
 * Feature F13: one till edits a table at a time. While a table's order page is open on a till,
 * that till holds a lease on the table here, on the main till (every call of every till runs on
 * the main till, F12). Others cannot take the table, nor save, cancel or move its order, until
 * the lease is released (page left, logout, window closed, satellite gone) or runs out (a till
 * that crashed or lost the network). In memory on purpose: a main-till restart frees every table,
 * and nothing is left behind in the database. Electron-free.
 *
 * `terminal` names who holds a lease: `local:<webContents id>` (a main-till window) or
 * `lan:<device id>` (a satellite, which has one window). The same user on another till is
 * someone else. Each till holds one table at most (its one order page).
 */

/** How long a lease lives without renewal (the order page renews it more often). */
export const LOCK_LEASE_MS = TABLE_LOCK_LEASE_MS;
const SWEEP_MS = 5_000;

export interface LockHolder {
  terminal: string;
  userId: number;
  userName: string;
}

interface Lease extends LockHolder {
  expiresAt: number;
}

export interface TableLocksOptions {
  now?: () => number;
  leaseMs?: number;
  /** Tables whose holder changed (taken, released, run out): the grids re-read. */
  onChange?: (tables: number[]) => void;
}

export function tableInUse(tableNumber: number, userName: string) {
  return conflict(`${tableNumber}-stol hozir ${userName} tomonidan ochilgan`, {
    reason: 'TABLE_IN_USE',
    tableNumber,
    userName,
  });
}

export class TableLocks {
  private readonly leases = new Map<number, Lease>();
  private readonly now: () => number;
  private readonly leaseMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly o: TableLocksOptions = {}) {
    this.now = o.now ?? Date.now;
    this.leaseMs = o.leaseMs ?? LOCK_LEASE_MS;
  }

  /** A live lease on the table, or null (an expired one is dropped on the way). */
  private live(tableNumber: number): Lease | null {
    const lease = this.leases.get(tableNumber);
    if (!lease) return null;
    if (lease.expiresAt > this.now()) return lease;
    this.leases.delete(tableNumber);
    this.changed([tableNumber]);
    return null;
  }

  private changed(tables: number[]): void {
    if (tables.length > 0) this.o.onChange?.(tables);
  }

  /**
   * Takes or renews the lease. Held by another till: refused (TABLE_IN_USE), unless `force`
   * (the caller checks that only an administrator forces).
   */
  take(tableNumber: number, holder: LockHolder, force = false): void {
    const current = this.live(tableNumber);
    if (current && current.terminal !== holder.terminal && !force) {
      throw tableInUse(tableNumber, current.userName);
    }
    const same =
      current !== null && current.terminal === holder.terminal && current.userId === holder.userId;
    // A till has one order page open: taking a table lets go of any other it held, so no till
    // can hold the whole floor.
    const freed: number[] = [];
    for (const [table, lease] of this.leases) {
      if (table !== tableNumber && lease.terminal === holder.terminal) {
        this.leases.delete(table);
        freed.push(table);
      }
    }
    this.leases.set(tableNumber, { ...holder, expiresAt: this.now() + this.leaseMs });
    this.changed(same ? freed : [...freed, tableNumber]);
  }

  /** Releases the table if this till holds it. */
  release(tableNumber: number, terminal: string): void {
    const current = this.live(tableNumber);
    if (current?.terminal !== terminal) return;
    this.leases.delete(tableNumber);
    this.changed([tableNumber]);
  }

  /** Everything a till holds (logout, window closed, satellite gone). */
  releaseTerminal(terminal: string): void {
    const freed: number[] = [];
    for (const [table, lease] of this.leases) {
      if (lease.terminal === terminal) {
        this.leases.delete(table);
        freed.push(table);
      }
    }
    this.changed(freed);
  }

  /** Refuses a change to the table from any till other than the one holding it. */
  assertFree(tableNumber: number, terminal: string): void {
    const current = this.live(tableNumber);
    if (current && current.terminal !== terminal) throw tableInUse(tableNumber, current.userName);
  }

  /**
   * The order moved away: the mover's lease on the old table goes (the screens leave the order
   * after a move, so the new table is not held either). Both tables are announced.
   */
  move(fromTable: number, toTable: number, terminal: string): void {
    const current = this.live(fromTable);
    if (current?.terminal === terminal) this.leases.delete(fromTable);
    this.changed([fromTable, toTable]);
  }

  list(terminal: string): TableLockDto[] {
    this.sweep();
    return [...this.leases]
      .sort(([a], [b]) => a - b)
      .map(([tableNumber, lease]) => ({
        tableNumber,
        userName: lease.userName,
        mine: lease.terminal === terminal,
      }));
  }

  /** Drops leases that ran out, so the other tills see the table free without asking. */
  sweep(): void {
    const t = this.now();
    const freed: number[] = [];
    for (const [table, lease] of this.leases) {
      if (lease.expiresAt <= t) {
        this.leases.delete(table);
        freed.push(table);
      }
    }
    this.changed(freed);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
