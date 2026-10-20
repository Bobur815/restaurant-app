/**
 * What a user may do (feature F2). Every user has an explicit list; the role (ADMIN, CASHIER,
 * STAFF) only fills in the defaults when a user is created or their role changes, and the admin
 * can tick any box on or off. Main checks the list on every call; the renderer only hides.
 */
export const PERMISSIONS = [
  /** Take and edit orders (tables, takeaway, delivery), cancel unpaid ones. */
  'orders',
  /** Close an order: take the payment. */
  'payments',
  /** Sell on debt (nasiya) and take repayments. */
  'debt',
  /** See and reprint paid checks. */
  'checks',
  /** Open, edit and close shifts. */
  'shifts',
  /** Dishes, categories, pictures. */
  'menu',
  /** Sales, leftovers and expense reports. */
  'reports',
  /** Edit and delete paid checks, delete shifts. */
  'corrections',
  /** Forgive debt, void repayments, assign and edit debtors. */
  'debtsAdmin',
  /** Settings: system, halls and tables, order types, payments, receipt, printer. */
  'settings',
  /** Users, their PINs and permissions; the recovery code. */
  'users',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = 'ADMIN' | 'CASHIER' | 'STAFF';
export const ROLES: readonly Role[] = ['ADMIN', 'CASHIER', 'STAFF'];

/** The boxes ticked for a new user of each role (decided 2026-10-20). */
export const ROLE_DEFAULTS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  CASHIER: ['orders', 'payments', 'debt', 'checks', 'shifts'],
  STAFF: ['orders'],
};

export function hasPermission(
  user: { permissions: readonly string[] } | null | undefined,
  permission: Permission,
): boolean {
  return !!user && user.permissions.includes(permission);
}

/** Known permissions only, in catalogue order, each once (anything else stored is ignored). */
export function cleanPermissions(list: readonly string[]): Permission[] {
  return PERMISSIONS.filter((p) => list.includes(p));
}
