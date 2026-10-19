import type { z } from 'zod';
import type { IpcResult } from './errors';
import type * as S from './schemas';
import type * as T from './types';

/**
 * Every IPC channel: what the renderer sends (`input`, before schema defaults) and what it gets
 * back in `IpcResult.data`. The main process implements exactly this map (src/main/ipc/handlers.ts
 * fails to compile otherwise); preload exposes it as window.electronAPI.<ns>.<method>
 * (src/main/preload-api.ts), and the renderer calls it through src/renderer/api.
 *
 * Access is decided in main per handler: `public` (before login), `user` (any logged-in role),
 * `admin`.
 */
type In<Schema extends z.ZodType> = z.input<Schema>;
type Channel<I, R> = { input: I; result: R };

export interface IpcChannels {
  // app
  'app:info': Channel<undefined, { name: string; version: string; isPackaged: boolean }>;

  // auth & users
  'auth:login': Channel<In<typeof S.loginInput>, T.CurrentUser>;
  'auth:logout': Channel<undefined, null>;
  'auth:me': Channel<undefined, T.CurrentUser | null>;
  'auth:changePassword': Channel<In<typeof S.changePasswordInput>, null>;
  /** Active users with a PIN, for the lock screen. */
  'auth:pinUsers': Channel<undefined, T.PinUserDto[]>;
  'auth:pinLogin': Channel<In<typeof S.pinLoginInput>, T.CurrentUser>;
  'auth:pinStatus': Channel<undefined, { hasPin: boolean }>;
  'auth:setPin': Channel<In<typeof S.setPinInput>, { hasPin: boolean }>;
  'users:list': Channel<undefined, T.UserDto[]>;
  'users:create': Channel<In<typeof S.createUserInput>, T.UserDto>;
  'users:update': Channel<In<typeof S.updateUserInput>, T.UserDto>;
  'users:resetPassword': Channel<In<typeof S.resetPasswordInput>, null>;
  'users:updateProfile': Channel<In<typeof S.updateProfileInput>, T.CurrentUser>;

  // setup & settings
  'setup:status': Channel<undefined, T.SetupStatus>;
  'setup:complete': Channel<In<typeof S.setupInput>, T.CurrentUser>;
  'settings:get': Channel<undefined, T.AppSettings>;
  'settings:update': Channel<In<typeof S.updateSettingsInput>, T.AppSettings>;
  'receipt:get': Channel<undefined, T.ReceiptSettingsDto | null>;
  'receipt:update': Channel<In<typeof S.updateReceiptSettingsInput>, T.ReceiptSettingsDto>;

  // printing (content always built in main from the database)
  'printing:printers': Channel<undefined, T.PrinterInfo[]>;
  'printing:printReceipt': Channel<In<typeof S.printReceiptInput>, { printer: string }>;
  'printing:test': Channel<undefined, { printer: string }>;
  /** PNG data URL of the sample receipt. */
  'printing:preview': Channel<In<typeof S.previewReceiptInput>, string>;

  // halls & tables
  'halls:list': Channel<In<typeof S.listHallsInput>, T.HallDto[]>;
  'halls:create': Channel<In<typeof S.hallInput>, T.HallDto>;
  'halls:update': Channel<In<typeof S.updateHallInput>, T.HallDto>;
  /** All halls in one transaction: `ids` is every hall id in the new order. */
  'halls:reorder': Channel<In<typeof S.reorderHallsInput>, T.HallDto[]>;
  /** Only a hall that never had tables; otherwise hide it (isActive: false). */
  'halls:delete': Channel<In<typeof S.idInput>, null>;
  'tables:create': Channel<In<typeof S.diningTableInput>, T.DiningTableDto>;
  'tables:createRange': Channel<In<typeof S.tableRangeInput>, T.DiningTableDto[]>;
  'tables:update': Channel<In<typeof S.updateDiningTableInput>, T.DiningTableDto>;
  /** Only a table no order ever used; otherwise hide it (isActive: false). */
  'tables:delete': Channel<In<typeof S.idInput>, null>;

  // menu
  'categories:list': Channel<In<typeof S.listCategoriesInput>, T.CategoryDto[]>;
  'categories:create': Channel<In<typeof S.categoryInput>, T.CategoryDto>;
  'categories:update': Channel<In<typeof S.updateCategoryInput>, T.CategoryDto>;
  'categories:delete': Channel<In<typeof S.idInput>, null>;
  'menu:list': Channel<In<typeof S.listMenuInput>, T.MenuItemDto[]>;
  'menu:get': Channel<In<typeof S.idInput>, T.MenuItemDto>;
  'menu:create': Channel<In<typeof S.menuItemInput>, T.MenuItemDto>;
  'menu:update': Channel<In<typeof S.updateMenuItemInput>, T.MenuItemDto>;
  'menu:delete': Channel<In<typeof S.idInput>, T.DeleteOutcome>;
  /** Opens a file dialog in main; returns the stored image's file name, or null if cancelled. */
  'menu:pickImage': Channel<undefined, string | null>;

  // sessions (shifts)
  'sessions:getOpen': Channel<undefined, T.SessionDto | null>;
  'sessions:get': Channel<In<typeof S.idInput>, T.SessionDto>;
  'sessions:list': Channel<In<typeof S.listSessionsInput>, T.SessionDto[]>;
  'sessions:pendingCarry': Channel<undefined, T.PendingCarryDto[]>;
  'sessions:open': Channel<In<typeof S.openSessionInput>, T.SessionDto>;
  'sessions:update': Channel<In<typeof S.updateSessionInput>, T.SessionDto>;
  'sessions:close': Channel<In<typeof S.closeSessionInput>, T.SessionCloseResult>;
  'sessions:delete': Channel<In<typeof S.idInput>, null>;

  // orders & payments
  'orders:busyTables': Channel<undefined, T.TableSummaryDto[]>;
  'orders:getTable': Channel<In<typeof S.tableInput>, T.OrderDto | null>;
  'orders:getByNumber': Channel<In<typeof S.orderNumberInput>, T.OrderDto>;
  'orders:save': Channel<In<typeof S.saveTableOrderInput>, T.OrderDto>;
  'orders:cancel': Channel<In<typeof S.cancelTableOrderInput>, T.OrderDto>;
  'payments:pay': Channel<In<typeof S.payOrderInput>, T.OrderDto>;
  'checks:list': Channel<In<typeof S.listChecksInput>, T.CheckDto[]>;
  'checks:update': Channel<In<typeof S.updatePaymentInput>, T.PaymentDto[]>;
  /** Removes the check's payments and cancels its order (stock back if the shift is open). */
  'checks:delete': Channel<In<typeof S.orderNumberInput>, T.OrderDto>;

  // residuals, expenses, reports
  'residuals:list': Channel<In<typeof S.listResidualsInput>, T.ResidualList>;
  'residuals:apply': Channel<In<typeof S.applyResidualsInput>, number>;
  'expenses:list': Channel<In<typeof S.listExpensesInput>, T.ExpenseList>;
  'reports:sales': Channel<In<typeof S.salesReportInput>, T.SalesReport>;
}

export type IpcChannel = keyof IpcChannels;
export type IpcInput<C extends IpcChannel> = IpcChannels[C]['input'];
export type IpcOutput<C extends IpcChannel> = IpcChannels[C]['result'];

/**
 * The same channels as a runtime list (types do not exist at runtime): preload builds the API
 * from it and main registers handlers from HANDLERS. Order is irrelevant.
 */
export const IPC_CHANNELS = [
  'app:info',
  'auth:login',
  'auth:logout',
  'auth:me',
  'auth:changePassword',
  'auth:pinUsers',
  'auth:pinLogin',
  'auth:pinStatus',
  'auth:setPin',
  'users:list',
  'users:create',
  'users:update',
  'users:resetPassword',
  'users:updateProfile',
  'setup:status',
  'setup:complete',
  'settings:get',
  'settings:update',
  'receipt:get',
  'receipt:update',
  'printing:printers',
  'printing:printReceipt',
  'printing:test',
  'printing:preview',
  'halls:list',
  'halls:create',
  'halls:update',
  'halls:reorder',
  'halls:delete',
  'tables:create',
  'tables:createRange',
  'tables:update',
  'tables:delete',
  'categories:list',
  'categories:create',
  'categories:update',
  'categories:delete',
  'menu:list',
  'menu:get',
  'menu:create',
  'menu:update',
  'menu:delete',
  'menu:pickImage',
  'sessions:getOpen',
  'sessions:get',
  'sessions:list',
  'sessions:pendingCarry',
  'sessions:open',
  'sessions:update',
  'sessions:close',
  'sessions:delete',
  'orders:busyTables',
  'orders:getTable',
  'orders:getByNumber',
  'orders:save',
  'orders:cancel',
  'payments:pay',
  'checks:list',
  'checks:update',
  'checks:delete',
  'residuals:list',
  'residuals:apply',
  'expenses:list',
  'reports:sales',
] as const satisfies readonly IpcChannel[];

// Compile-time: IPC_CHANNELS lists every channel in IpcChannels (an omission is a type error).
type MissingChannels = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>;
const _everyChannelListed: [MissingChannels] extends [never] ? true : MissingChannels = true;
void _everyChannelListed;

// ── Namespaced API shape: 'orders:save' -> api.orders.save(input) ───────────────────────────

export type IpcNamespace = IpcChannel extends `${infer NS}:${string}` ? NS : never;
export type IpcMethod<NS extends IpcNamespace> = IpcChannel extends infer C
  ? C extends `${NS}:${infer M}`
    ? M
    : never
  : never;
export type ChannelOf<NS extends IpcNamespace, M extends string> = `${NS}:${M}` & IpcChannel;

/** A call whose input may be left out when the channel takes none or all of it is optional. */
export type CallFn<C extends IpcChannel, R> =
  undefined extends IpcInput<C>
    ? (input?: IpcInput<C>) => Promise<R>
    : (input: IpcInput<C>) => Promise<R>;

/** Splits 'orders:save' into ['orders', 'save']. */
export function splitChannel(channel: IpcChannel): [IpcNamespace, string] {
  const i = channel.indexOf(':');
  return [channel.slice(0, i) as IpcNamespace, channel.slice(i + 1)];
}

// ── Events: main -> every window, after a change ──────────────────────────────────────────

/** The one main -> renderer push channel. */
export const APP_EVENT_CHANNEL = 'app:event';

/**
 * "Something changed, refetch what you show." Small and data-free on purpose: the receiver reloads
 * through the normal API, so permissions and freshness stay in one place.
 */
export type AppEvent =
  | { type: 'orders-changed'; tableNumber?: number }
  | { type: 'session-changed' }
  | { type: 'menu-changed' }
  | { type: 'settings-changed' }
  | { type: 'users-changed' }
  | { type: 'halls-changed' };

export const APP_EVENT_TYPES = [
  'orders-changed',
  'session-changed',
  'menu-changed',
  'settings-changed',
  'users-changed',
  'halls-changed',
] as const satisfies ReadonlyArray<AppEvent['type']>;

/** What preload exposes as window.electronAPI. Results are raw IpcResult; renderer/api unwraps. */
export type ElectronAPI = {
  [NS in IpcNamespace]: {
    [M in IpcMethod<NS>]: CallFn<ChannelOf<NS, M>, IpcResult<IpcOutput<ChannelOf<NS, M>>>>;
  };
} & {
  events: {
    /** Calls `listener` for every AppEvent; returns the function that stops it. */
    subscribe(listener: (event: AppEvent) => void): () => void;
  };
};
