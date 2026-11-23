import type { z } from 'zod';
import type { IpcResult } from './errors';
import type * as S from './schemas';
import type * as T from './types';
import type * as L from './license';

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

  // auth & users (feature F2: PIN-only login)
  'auth:pinLogin': Channel<In<typeof S.pinLoginInput>, T.CurrentUser>;
  'auth:logout': Channel<undefined, null>;
  'auth:me': Channel<undefined, T.CurrentUser | null>;
  /** Forgotten admin PIN: recovery code + new PIN; returns the next recovery code (once). */
  'auth:recover': Channel<In<typeof S.recoverInput>, T.LoginWithCodeDto>;
  /** Nobody with the users permission can log in (after an upgrade): who could. */
  'auth:bootstrapStatus': Channel<undefined, { needed: boolean; admins: T.AdminChoiceDto[] }>;
  'auth:bootstrapPin': Channel<In<typeof S.bootstrapPinInput>, T.LoginWithCodeDto>;
  /** Whether a recovery code exists; a new one is made (and shown once) on request. */
  'auth:recoveryStatus': Channel<undefined, { hasCode: boolean }>;
  'auth:newRecoveryCode': Channel<undefined, { recoveryCode: string }>;
  'users:list': Channel<undefined, T.UserDto[]>;
  'users:create': Channel<In<typeof S.createUserInput>, T.UserDto>;
  'users:update': Channel<In<typeof S.updateUserInput>, T.UserDto>;
  'users:updateProfile': Channel<In<typeof S.updateProfileInput>, T.CurrentUser>;

  // setup & settings
  'setup:status': Channel<undefined, T.SetupStatus>;
  'setup:complete': Channel<In<typeof S.setupInput>, T.LoginWithCodeDto>;
  'settings:get': Channel<undefined, T.AppSettings>;
  'settings:update': Channel<In<typeof S.updateSettingsInput>, T.AppSettings>;
  'receipt:get': Channel<undefined, T.ReceiptSettingsDto | null>;
  'receipt:update': Channel<In<typeof S.updateReceiptSettingsInput>, T.ReceiptSettingsDto>;
  'receipt:layouts': Channel<undefined, T.ReceiptLayoutDto[]>;
  'receipt:updateLayout': Channel<In<typeof S.updateReceiptLayoutInput>, T.ReceiptLayoutDto>;
  // The pre-bill ("Hisob", feature F9).
  'receipt:preBillLayout': Channel<undefined, T.PreBillLayoutDto>;
  'receipt:updatePreBillLayout': Channel<In<typeof S.updatePreBillLayoutInput>, T.PreBillLayoutDto>;
  /** Copies a picked picture into the image store; its file name, or null when cancelled. */
  'receipt:pickImage': Channel<undefined, string | null>;

  // printing (content always built in main from the database)
  'printing:printers': Channel<undefined, T.PrinterInfo[]>;
  'printing:printReceipt': Channel<In<typeof S.printReceiptInput>, { printer: string }>;
  'printing:printPreBill': Channel<In<typeof S.printPreBillInput>, { printer: string }>;
  'printing:test': Channel<In<typeof S.testPrintInput>, { printer: string }>;
  'printing:shiftReport': Channel<In<typeof S.shiftReportInput>, { printer: string }>;
  /** PNG data URL of the sample receipt. */
  'printing:preview': Channel<In<typeof S.previewReceiptInput>, string>;
  /** A short sample ticket to one printer (feature F11). */
  'printing:testPrinter': Channel<In<typeof S.printerIdInput>, { printer: string }>;

  // printers and kitchen tickets (feature F11)
  'printers:list': Channel<In<typeof S.listPrintersInput>, T.PrinterDto[]>;
  'printers:create': Channel<In<typeof S.printerInput>, T.PrinterDto>;
  'printers:update': Channel<In<typeof S.updatePrinterInput>, T.PrinterDto>;
  /** Makes another printer the main one (receipts, pre-bills, reports). */
  'printers:setMain': Channel<In<typeof S.printerIdInput>, T.PrinterDto[]>;
  // LAN: satellite tills (feature F12). Main till side (settings permission):
  'lan:status': Channel<undefined, T.LanStatusDto>;
  'lan:update': Channel<In<typeof S.lanUpdateInput>, T.LanStatusDto>;
  'lan:pairingCode': Channel<In<typeof S.lanPairingCodeInput>, T.LanStatusDto>;
  'lan:cancelPairing': Channel<undefined, T.LanStatusDto>;
  'lan:revoke': Channel<In<typeof S.lanDeviceInput>, T.LanStatusDto>;
  /** This till's role and, on a satellite, the line to its main till (public: the login screen). */
  'lan:link': Channel<undefined, T.LanLinkDto>;
  /** Become a satellite of the main till at that address (the app restarts). */
  'lan:join': Channel<In<typeof S.lanJoinInput>, T.LanLinkDto>;
  /** A satellite becomes a till of its own again (the app restarts). */
  'lan:leave': Channel<undefined, T.LanLinkDto>;
  /** Recent kitchen tickets that failed to print. */
  'kitchen:failed': Channel<undefined, T.KitchenTicketDto[]>;
  'kitchen:reprint': Channel<In<typeof S.ticketIdInput>, { printer: string }>;

  // software update (feature F4); the updater pushes 'update-changed' as its state moves
  'updater:status': Channel<undefined, T.UpdateStatusDto>;
  'updater:check': Channel<undefined, T.UpdateStatusDto>;
  'updater:download': Channel<undefined, T.UpdateStatusDto>;
  /** Quits the app, installs silently and starts the new version. */
  'updater:install': Channel<undefined, null>;

  // licence (feature F5): the posgro server licenses this till; main enforces it on every call
  'license:status': Channel<undefined, L.LicenseStatusDto>;
  'license:plans': Channel<undefined, L.LicensePlansDto>;
  /** Sends the phone; the answer has the Telegram link that proves it. */
  'license:signupStart': Channel<In<typeof S.licenseSignupStartInput>, L.SignupStartDto>;
  'license:signupStatus': Channel<
    In<typeof S.licenseSignupStatusInput>,
    { contactConfirmed: boolean; expired: boolean }
  >;
  'license:signupComplete': Channel<In<typeof S.licenseSignupCompleteInput>, L.LicenseStatusDto>;
  'license:activate': Channel<In<typeof S.licenseActivateInput>, L.LicenseStatusDto>;
  'license:checkNow': Channel<undefined, L.LicenseStatusDto>;

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
  'sessions:lastUnlimited': Channel<undefined, number[]>;
  'sessions:cashSummary': Channel<In<typeof S.idInput>, T.ShiftCashSummaryDto>;
  'sessions:addCashMovement': Channel<In<typeof S.addCashMovementInput>, T.CashMovementDto>;
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
  'orders:moveTable': Channel<In<typeof S.moveTableInput>, T.OrderDto>;
  /** F13: one till edits a table at a time (lease on the main till, renewed by the order page). */
  'orders:lockTable': Channel<In<typeof S.lockTableInput>, T.TableLockResultDto>;
  'orders:unlockTable': Channel<In<typeof S.tableInput>, null>;
  'orders:tableLocks': Channel<undefined, T.TableLockDto[]>;
  'orders:get': Channel<In<typeof S.idInput>, T.OrderDto>;
  /** Unpaid takeaway and delivery orders. */
  'orders:openList': Channel<undefined, T.OpenOrderSummaryDto[]>;
  'orders:saveOpen': Channel<In<typeof S.saveOpenOrderInput>, T.OrderDto>;
  'orders:cancelOpen': Channel<In<typeof S.orderIdInput>, T.OrderDto>;
  'orders:setDeliveryStatus': Channel<In<typeof S.deliveryStatusInput>, T.OrderDto>;
  /** Autofill for the order form; null when the phone is unknown or incomplete. */
  'customers:findByPhone': Channel<In<typeof S.phoneLookupInput>, T.CustomerLookupDto | null>;
  'payments:pay': Channel<In<typeof S.payOrderInput>, T.OrderDto>;
  'checks:list': Channel<In<typeof S.listChecksInput>, T.CheckDto[]>;
  'checks:update': Channel<In<typeof S.editCheckInput>, T.OrderDto>;
  /**
   * Removes the check's payments and cancels its order (stock back if the shift is open). A
   * fiscalised check gets its VCR refund first (F18; `scannedQr` when VCR masked the link).
   */
  'checks:delete': Channel<In<typeof S.deleteCheckInput>, T.OrderDto>;

  // fiscal receipts through REGOS:VCR (feature F18), on the main till
  'fiscal:getConfig': Channel<undefined, T.FiscalConfigDto>;
  'fiscal:setConfig': Channel<In<typeof S.fiscalConfigInput>, T.FiscalConfigDto>;
  'fiscal:testConnection': Channel<undefined, T.FiscalConnectionDto>;
  /** For every user: is it on, and how many checks wait (the top bar counter). */
  'fiscal:status': Channel<undefined, T.FiscalStatusDto>;
  /** VCR's current Z-report; null when fiscal receipts are off. */
  'fiscal:zReport': Channel<undefined, T.FiscalZReportDto | null>;
  'fiscal:zOpen': Channel<undefined, T.FiscalZReportDto>;
  'fiscal:zClose': Channel<undefined, T.FiscalZReportDto>;
  'fiscal:retry': Channel<In<typeof S.fiscalOrderInput>, T.OrderDto>;
  'fiscal:retryAll': Channel<undefined, T.FiscalRetryAllDto>;
  /** VCR prints a copy of the fiscal receipt. */
  'fiscal:duplicate': Channel<In<typeof S.fiscalOrderInput>, null>;

  // debt (nasiya, feature F1-C): any user records and takes repayments; admins correct
  'debts:list': Channel<In<typeof S.listDebtorsInput>, T.DebtorDto[]>;
  'debts:get': Channel<In<typeof S.debtorInput>, T.DebtorDetailDto>;
  'debts:repay': Channel<In<typeof S.repayInput>, T.DebtorDetailDto>;
  'debts:writeOff': Channel<In<typeof S.writeOffInput>, T.DebtorDetailDto>;
  'debts:void': Channel<In<typeof S.voidRepaymentInput>, T.DebtorDetailDto>;
  'debts:assign': Channel<In<typeof S.assignDebtInput>, T.DebtorDetailDto>;
  'customers:update': Channel<In<typeof S.updateCustomerInput>, T.DebtorDetailDto>;

  // residuals, expenses, reports
  'residuals:list': Channel<In<typeof S.listResidualsInput>, T.ResidualList>;
  'residuals:apply': Channel<In<typeof S.applyResidualsInput>, number>;
  'expenses:list': Channel<In<typeof S.listExpensesInput>, T.ExpenseList>;
  'reports:sales': Channel<In<typeof S.salesReportInput>, T.SalesReport>;
  'reports:staff': Channel<In<typeof S.staffReportInput>, T.StaffReport>;
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
  'auth:pinLogin',
  'auth:logout',
  'auth:me',
  'auth:recover',
  'auth:bootstrapStatus',
  'auth:bootstrapPin',
  'auth:recoveryStatus',
  'auth:newRecoveryCode',
  'users:list',
  'users:create',
  'users:update',
  'users:updateProfile',
  'setup:status',
  'setup:complete',
  'settings:get',
  'settings:update',
  'receipt:get',
  'receipt:update',
  'receipt:layouts',
  'receipt:updateLayout',
  'receipt:preBillLayout',
  'receipt:updatePreBillLayout',
  'receipt:pickImage',
  'printing:printers',
  'printing:printReceipt',
  'printing:printPreBill',
  'printing:test',
  'printing:shiftReport',
  'printing:preview',
  'printing:testPrinter',
  'printers:list',
  'printers:create',
  'printers:update',
  'printers:setMain',
  'kitchen:failed',
  'kitchen:reprint',
  'lan:status',
  'lan:update',
  'lan:pairingCode',
  'lan:cancelPairing',
  'lan:revoke',
  'lan:link',
  'lan:join',
  'lan:leave',
  'updater:status',
  'updater:check',
  'updater:download',
  'updater:install',
  'license:status',
  'license:plans',
  'license:signupStart',
  'license:signupStatus',
  'license:signupComplete',
  'license:activate',
  'license:checkNow',
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
  'sessions:lastUnlimited',
  'sessions:cashSummary',
  'sessions:addCashMovement',
  'sessions:open',
  'sessions:update',
  'sessions:close',
  'sessions:delete',
  'orders:busyTables',
  'orders:getTable',
  'orders:getByNumber',
  'orders:save',
  'orders:cancel',
  'orders:moveTable',
  'orders:lockTable',
  'orders:unlockTable',
  'orders:tableLocks',
  'orders:get',
  'orders:openList',
  'orders:saveOpen',
  'orders:cancelOpen',
  'orders:setDeliveryStatus',
  'customers:findByPhone',
  'payments:pay',
  'checks:list',
  'checks:update',
  'checks:delete',
  'fiscal:getConfig',
  'fiscal:setConfig',
  'fiscal:testConnection',
  'fiscal:status',
  'fiscal:zReport',
  'fiscal:zOpen',
  'fiscal:zClose',
  'fiscal:retry',
  'fiscal:retryAll',
  'fiscal:duplicate',
  'debts:list',
  'debts:get',
  'debts:repay',
  'debts:writeOff',
  'debts:void',
  'debts:assign',
  'customers:update',
  'residuals:list',
  'residuals:apply',
  'expenses:list',
  'reports:sales',
  'reports:staff',
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
  /** tableNumber for a dine-in order, orderId always when one order changed. */
  | { type: 'orders-changed'; tableNumber?: number; orderId?: number }
  | { type: 'session-changed' }
  | { type: 'menu-changed' }
  | { type: 'settings-changed' }
  | { type: 'users-changed' }
  | { type: 'halls-changed' }
  | { type: 'debts-changed' }
  /** The software updater's state moved (re-read updater:status). */
  | { type: 'update-changed' }
  /** The licence or the till's mode changed (re-read license:status). */
  | { type: 'license-changed' }
  /** A kitchen ticket printed or failed (feature F11; re-read kitchen:failed). */
  | { type: 'kitchen-changed' }
  /** Satellites, pairing or this satellite's line to its main till changed (F12; re-read lan:*). */
  | { type: 'lan-changed' };

export const APP_EVENT_TYPES = [
  'orders-changed',
  'session-changed',
  'menu-changed',
  'settings-changed',
  'users-changed',
  'halls-changed',
  'debts-changed',
  'update-changed',
  'license-changed',
  'kitchen-changed',
  'lan-changed',
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
