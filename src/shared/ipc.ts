import type { z } from 'zod';
import type * as S from './schemas';
import type * as T from './types';

/**
 * Every IPC channel: what the renderer sends (`input`, before schema defaults) and what it gets
 * back in `IpcResult.data`. The main process implements exactly this map (src/main/ipc/handlers.ts
 * fails to compile otherwise); preload (Phase 4) exposes it as window.electronAPI.<ns>.<method>.
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
