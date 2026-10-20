import type { AppEvent, IpcChannel, IpcInput, IpcOutput } from '@shared/ipc';

/**
 * Channels that only read. Everything else changes data and must say what it changes in
 * CHANNEL_EVENTS (events.test.ts enforces that every channel is in exactly one of the two).
 */
export const READ_ONLY_CHANNELS = [
  'app:info',
  'auth:me',
  'auth:bootstrapStatus',
  'auth:recoveryStatus',
  'users:list',
  'setup:status',
  'settings:get',
  'receipt:get',
  'receipt:layouts',
  'receipt:pickImage', // stores a file; the layout changes on receipt:updateLayout
  // Printing changes no data.
  'printing:printers',
  'printing:printReceipt',
  'printing:test',
  'printing:preview',
  'updater:status',
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
  'orders:get',
  'orders:openList',
  'customers:findByPhone',
  'debts:list',
  'debts:get',
  'checks:list',
  'residuals:list',
  'expenses:list',
  'reports:sales',
] as const satisfies readonly IpcChannel[];

type Emit<C extends IpcChannel> = (input: IpcInput<C>, data: IpcOutput<C>) => AppEvent[];
type Mutating = Exclude<IpcChannel, (typeof READ_ONLY_CHANNELS)[number]>;

const orders = (order?: { id: number; tableNumber: number | null }): AppEvent =>
  order
    ? { type: 'orders-changed', orderId: order.id, tableNumber: order.tableNumber ?? undefined }
    : { type: 'orders-changed' };
const SESSION: AppEvent = { type: 'session-changed' };
const MENU: AppEvent = { type: 'menu-changed' };
const SETTINGS: AppEvent = { type: 'settings-changed' };
const USERS: AppEvent = { type: 'users-changed' };
const HALLS: AppEvent = { type: 'halls-changed' };
const DEBTS: AppEvent = { type: 'debts-changed' };

/**
 * What each successful change announces to every window (replaces legacy's `session-updated` /
 * `menu-updated` -> `reload-menu` relays between parent and child windows). Login and logout only
 * affect the calling window, so they announce nothing.
 */
export const CHANNEL_EVENTS: { [C in Mutating]: Emit<C> } = {
  'auth:pinLogin': () => [],
  'auth:logout': () => [],
  'auth:recover': () => [USERS],
  'auth:bootstrapPin': () => [USERS],
  'auth:newRecoveryCode': () => [],
  'users:create': () => [USERS],
  'users:update': () => [USERS],
  'users:updateProfile': () => [USERS],
  'setup:complete': () => [SETTINGS, USERS],
  'settings:update': () => [SETTINGS],
  'receipt:update': () => [SETTINGS],
  'receipt:updateLayout': () => [SETTINGS],
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
  'orders:save': (_input, order) => [orders(order), SESSION],
  'orders:cancel': (_input, order) => [orders(order), SESSION],
  'orders:saveOpen': (_input, order) => [orders(order), SESSION],
  'orders:cancelOpen': (_input, order) => [orders(order), SESSION],
  'orders:setDeliveryStatus': (_input, order) => [orders(order)],
  // A payment may add debt; a check edit or delete may change it.
  'payments:pay': (_input, order) => [orders(order), DEBTS],
  'checks:update': (_input, order) => [orders(order), DEBTS],
  'checks:delete': (_input, order) => [orders(order), SESSION, DEBTS],
  'debts:repay': () => [DEBTS, orders()],
  'debts:writeOff': () => [DEBTS, orders()],
  'debts:void': () => [DEBTS, orders()],
  'debts:assign': () => [DEBTS, orders()],
  'customers:update': () => [DEBTS],
  'residuals:apply': () => [SESSION],
  // The updater broadcasts update-changed itself as its state moves (updater.ts onChange).
  'updater:check': () => [],
  'updater:download': () => [],
  'updater:install': () => [],
};

export function eventsFor<C extends IpcChannel>(
  channel: C,
  input: unknown,
  data: unknown,
): AppEvent[] {
  const emit = (CHANNEL_EVENTS as Partial<Record<IpcChannel, Emit<IpcChannel>>>)[channel];
  return emit ? emit(input as never, data as never) : [];
}
