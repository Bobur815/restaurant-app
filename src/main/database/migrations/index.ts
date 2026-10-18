import { sql as init } from './0001_init';
import { sql as sessionOpenGuard } from './0002_session_open_guard';
import { sql as orderPendingTable } from './0003_order_pending_table';
import { sql as menuItemCostPrice } from './0004_menu_item_cost_price';
import { sql as userPinCode } from './0005_user_pin_code';

export interface Migration {
  /** Becomes PRAGMA user_version once applied. Consecutive, starting at 1. */
  version: number;
  name: string;
  sql: string;
}

/**
 * Every schema change, in order. Append only: a released migration is never edited, reordered or
 * removed, because installed databases have already applied it. Changes are additive (new
 * tables, new nullable or defaulted columns, new indexes, triggers); see the header of
 * prisma/schema.sqlite.prisma.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: init },
  { version: 2, name: 'session_open_guard', sql: sessionOpenGuard },
  { version: 3, name: 'order_pending_table', sql: orderPendingTable },
  { version: 4, name: 'menu_item_cost_price', sql: menuItemCostPrice },
  { version: 5, name: 'user_pin_code', sql: userPinCode },
];
