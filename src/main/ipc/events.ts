import type { AppEvent, IpcChannel, IpcInput, IpcOutput } from '@shared/ipc';

/**
 * Channels that only read. Everything else changes data and must say what it changes in
 * CHANNEL_EVENTS (events.test.ts enforces that every channel is in exactly one of the two).
 */
export const READ_ONLY_CHANNELS = [
  'app:info',
  'auth:me',
  'auth:pinUsers',
  'auth:pinStatus',
  'users:list',
  'setup:status',
  'settings:get',
  'receipt:get',
  // Printing changes no data.
  'printing:printers',
  'printing:printReceipt',
  'printing:test',
  'printing:preview',
  'halls:list',
  'categories:list',
  'menu:list',
  'menu:get',
  'sessions:getOpen',
  'sessions:get',
  'sessions:list',
  'sessions:pendingCarry',
  'orders:busyTables',
  'orders:getTable',
  'orders:getByNumber',
  'checks:list',
  'residuals:list',
  'expenses:list',
  'reports:sales',
] as const satisfies readonly IpcChannel[];

type Emit<C extends IpcChannel> = (input: IpcInput<C>, data: IpcOutput<C>) => AppEvent[];
type Mutating = Exclude<IpcChannel, (typeof READ_ONLY_CHANNELS)[number]>;

const orders = (tableNumber?: number): AppEvent => ({ type: 'orders-changed', tableNumber });
const SESSION: AppEvent = { type: 'session-changed' };
const MENU: AppEvent = { type: 'menu-changed' };
const SETTINGS: AppEvent = { type: 'settings-changed' };
const USERS: AppEvent = { type: 'users-changed' };
const HALLS: AppEvent = { type: 'halls-changed' };

/**
 * What each successful change announces to every window (replaces legacy's `session-updated` /
 * `menu-updated` -> `reload-menu` relays between parent and child windows). Login and logout only
 * affect the calling window, so they announce nothing.
 */
export const CHANNEL_EVENTS: { [C in Mutating]: Emit<C> } = {
  'auth:login': () => [],
  'auth:logout': () => [],
  'auth:changePassword': () => [],
  'auth:pinLogin': () => [],
  // The lock screen's user list changes.
  'auth:setPin': () => [USERS],
  'users:create': () => [USERS],
  'users:update': () => [USERS],
  'users:resetPassword': () => [USERS],
  'users:updateProfile': () => [USERS],
  'setup:complete': () => [SETTINGS, USERS],
  'settings:update': () => [SETTINGS],
  'receipt:update': () => [SETTINGS],
  'halls:create': () => [HALLS],
  'halls:update': () => [HALLS],
  'halls:reorder': () => [HALLS],
  'halls:delete': () => [HALLS],
  'tables:create': () => [HALLS],
  'tables:createRange': () => [HALLS],
  'tables:update': () => [HALLS],
  'tables:delete': () => [HALLS],
  'categories:create': () => [MENU],
  'categories:update': () => [MENU],
  'categories:delete': () => [MENU],
  'menu:create': () => [MENU],
  'menu:update': () => [MENU],
  'menu:delete': () => [MENU],
  'menu:pickImage': () => [], // stores a file; the dish changes on menu:create/update
  'sessions:open': () => [SESSION],
  'sessions:update': () => [SESSION],
  'sessions:close': () => [SESSION],
  'sessions:delete': () => [SESSION],
  // Orders move shift stock, so the shift view refreshes too.
  'orders:save': (_input, order) => [orders(order.tableNumber), SESSION],
  'orders:cancel': (_input, order) => [orders(order.tableNumber), SESSION],
  'payments:pay': (_input, order) => [orders(order.tableNumber)],
  'checks:update': () => [orders()],
  'checks:delete': (_input, order) => [orders(order.tableNumber), SESSION],
  'residuals:apply': () => [SESSION],
};

export function eventsFor<C extends IpcChannel>(
  channel: C,
  input: unknown,
  data: unknown,
): AppEvent[] {
  const emit = (CHANNEL_EVENTS as Partial<Record<IpcChannel, Emit<IpcChannel>>>)[channel];
  return emit ? emit(input as never, data as never) : [];
}
