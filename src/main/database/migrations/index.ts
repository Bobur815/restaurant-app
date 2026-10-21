import { sql as init } from './0001_init';
import { sql as sessionOpenGuard } from './0002_session_open_guard';
import { sql as orderPendingTable } from './0003_order_pending_table';
import { sql as menuItemCostPrice } from './0004_menu_item_cost_price';
import { sql as userPinCode } from './0005_user_pin_code';
import { sql as hallsTables } from './0006_halls_tables';
import { sql as orderTypesCustomers } from './0007_order_types_customers';
import { sql as splitPaymentDebt } from './0008_split_payment_debt';
import { sql as pinLoginPermissions } from './0009_pin_login_permissions';
import { sql as receiptLayouts } from './0010_receipt_layouts';
import { sql as licenseState } from './0011_license_state';
import { sql as shiftCashUnlimited } from './0012_shift_cash_unlimited';

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
  { version: 6, name: 'halls_tables', sql: hallsTables },
  { version: 7, name: 'order_types_customers', sql: orderTypesCustomers },
  { version: 8, name: 'split_payment_debt', sql: splitPaymentDebt },
  { version: 9, name: 'pin_login_permissions', sql: pinLoginPermissions },
  { version: 10, name: 'receipt_layouts', sql: receiptLayouts },
  { version: 11, name: 'license_state', sql: licenseState },
  { version: 12, name: 'shift_cash_unlimited', sql: shiftCashUnlimited },
];
