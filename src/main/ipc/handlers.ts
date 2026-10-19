import type { z } from 'zod';
import * as S from '@shared/schemas';
import type { IpcChannel } from '@shared/ipc';
import { changePassword, listPinUsers, login, pinLogin, pinStatus, setPin } from '../auth/auth';
import {
  createHall,
  createTable,
  createTableRange,
  deleteHall,
  deleteTable,
  listHalls,
  reorderHalls,
  updateHall,
  updateTable,
} from '../halls/halls';
import { createCategory, deleteCategory, listCategories, updateCategory } from '../menu/categories';
import {
  createMenuItem,
  deleteMenuItem,
  getMenuItem,
  listMenuItems,
  updateMenuItem,
} from '../menu/menu-items';
import { findCustomerByPhone } from '../customers/customers';
import {
  cancelOpenOrder,
  cancelTableOrder,
  getOrder,
  getOrderByNumber,
  getTableOrder,
  listBusyTables,
  listOpenOrders,
  saveOpenOrder,
  saveTableOrder,
  setDeliveryStatus,
} from '../orders/orders';
import { cancelPaidOrder, listChecks, payOrder, updatePayment } from '../payments/payments';
import { previewReceipt, printOrderReceipt, printTestReceipt } from '../printing/printing';
import { salesReport } from '../reports/reports';
import { applyResiduals, listExpenses, listResiduals } from '../residuals/residuals';
import {
  closeSession,
  deleteSession,
  getOpenSession,
  getPendingCarry,
  getSession,
  listSessions,
  openSession,
  updateOpenSession,
} from '../sessions/sessions';
import {
  getReceiptSettings,
  getSettings,
  updateReceiptSettings,
  updateSettings,
} from '../settings/settings';
import { completeSetup, getSetupStatus } from '../settings/setup';
import { createUser, listUsers, resetPassword, updateProfile, updateUser } from '../users/users';
import type { AnyHandlerDef, HandlerDef, PublicHandlerDef } from './ipc-safe';

// Typed builders: each infers the handler's input type from its schema.
const pub = <C extends IpcChannel, Sc extends z.ZodType>(
  input: Sc,
  run: PublicHandlerDef<C, Sc>['run'],
) => ({ access: 'public', input, run }) as PublicHandlerDef<C, Sc>;
const user = <C extends IpcChannel, Sc extends z.ZodType>(
  input: Sc,
  run: HandlerDef<C, Sc>['run'],
) => ({ access: 'user', input, run }) as HandlerDef<C, Sc>;
const admin = <C extends IpcChannel, Sc extends z.ZodType>(
  input: Sc,
  run: HandlerDef<C, Sc>['run'],
) => ({ access: 'admin', input, run }) as HandlerDef<C, Sc>;

/**
 * Every channel in shared/ipc.ts, with who may call it. The mapped type makes a missing or
 * extra channel a compile error. Handlers stay thin: parse (done by invokeHandler), call the
 * domain module, return its DTO.
 */
export const HANDLERS: { [C in IpcChannel]: AnyHandlerDef<C> } = {
  'app:info': pub(S.empty, async (ctx) => ctx.services.appInfo()),

  // ── auth & users ───────────────────────────────────────────────────────────────────────────
  'auth:login': pub(S.loginInput, async (ctx, input) => {
    const user = await login(ctx.db, input);
    ctx.setActor(user);
    return user;
  }),
  'auth:logout': pub(S.empty, async (ctx) => {
    ctx.setActor(null);
    return null;
  }),
  'auth:me': pub(S.empty, async (ctx) => ctx.actor),
  'auth:changePassword': user(S.changePasswordInput, async (ctx, input) => {
    await changePassword(ctx.db, ctx.actor, input);
    return null;
  }),
  // Public: the lock screen lists who can unlock (names only) before anyone is logged in.
  'auth:pinUsers': pub(S.empty, (ctx) => listPinUsers(ctx.db)),
  'auth:pinLogin': pub(S.pinLoginInput, async (ctx, input) => {
    const user = await pinLogin(ctx.db, input);
    ctx.setActor(user);
    return user;
  }),
  'auth:pinStatus': user(S.empty, (ctx) => pinStatus(ctx.db, ctx.actor)),
  'auth:setPin': user(S.setPinInput, (ctx, input) => setPin(ctx.db, ctx.actor, input)),
  'users:list': admin(S.empty, (ctx) => listUsers(ctx.db)),
  'users:create': admin(S.createUserInput, (ctx, input) => createUser(ctx.db, input)),
  'users:update': admin(S.updateUserInput, (ctx, input) => updateUser(ctx.db, ctx.actor, input)),
  'users:resetPassword': admin(S.resetPasswordInput, async (ctx, input) => {
    await resetPassword(ctx.db, input);
    return null;
  }),
  'users:updateProfile': user(S.updateProfileInput, async (ctx, input) => {
    const me = await updateProfile(ctx.db, ctx.actor, input);
    ctx.setActor(me);
    return me;
  }),

  // ── setup & settings ───────────────────────────────────────────────────────────────────────
  'setup:status': pub(S.empty, (ctx) => getSetupStatus(ctx.db)),
  // Public by necessity (no users exist yet); completeSetup refuses once any admin exists.
  'setup:complete': pub(S.setupInput, async (ctx, input) => {
    const admin = await completeSetup(ctx.db, input);
    ctx.setActor(admin);
    return admin;
  }),
  // Public: the login screen needs language, theme and the restaurant name.
  'settings:get': pub(S.empty, (ctx) => getSettings(ctx.db)),
  'settings:update': admin(S.updateSettingsInput, (ctx, input) => updateSettings(ctx.db, input)),
  'receipt:get': pub(S.empty, (ctx) => getReceiptSettings(ctx.db)),
  'receipt:update': admin(S.updateReceiptSettingsInput, (ctx, input) =>
    updateReceiptSettings(ctx.db, input),
  ),

  // ── printing ─────────────────────────────────────────────────────────────────────────────
  'printing:printers': admin(S.empty, (ctx) => ctx.services.printer.list()),
  'printing:printReceipt': user(S.printReceiptInput, (ctx, { orderId }) =>
    printOrderReceipt(ctx.db, ctx.services.printer, orderId),
  ),
  'printing:test': admin(S.empty, (ctx) => printTestReceipt(ctx.db, ctx.services.printer)),
  'printing:preview': admin(S.previewReceiptInput, (ctx, input) =>
    previewReceipt(ctx.db, ctx.services.printer, input),
  ),

  // ── halls & tables ───────────────────────────────────────────────────────────────────────
  // Hidden halls and tables are for the settings page (admins); everyone else sees active ones.
  'halls:list': user(S.listHallsInput, (ctx, input) =>
    listHalls(ctx.db, { includeInactive: input.includeInactive && ctx.actor.role === 'ADMIN' }),
  ),
  'halls:create': admin(S.hallInput, (ctx, input) => createHall(ctx.db, input)),
  'halls:update': admin(S.updateHallInput, (ctx, input) => updateHall(ctx.db, input)),
  'halls:reorder': admin(S.reorderHallsInput, (ctx, { ids }) => reorderHalls(ctx.db, ids)),
  'halls:delete': admin(S.idInput, async (ctx, { id }) => {
    await deleteHall(ctx.db, id);
    return null;
  }),
  'tables:create': admin(S.diningTableInput, (ctx, input) => createTable(ctx.db, input)),
  'tables:createRange': admin(S.tableRangeInput, (ctx, input) => createTableRange(ctx.db, input)),
  'tables:update': admin(S.updateDiningTableInput, (ctx, input) => updateTable(ctx.db, input)),
  'tables:delete': admin(S.idInput, async (ctx, { id }) => {
    await deleteTable(ctx.db, id);
    return null;
  }),

  // ── menu ───────────────────────────────────────────────────────────────────────────────────
  'categories:list': user(S.listCategoriesInput, (ctx, input) => listCategories(ctx.db, input)),
  'categories:create': admin(S.categoryInput, (ctx, input) => createCategory(ctx.db, input)),
  'categories:update': admin(S.updateCategoryInput, (ctx, input) => updateCategory(ctx.db, input)),
  'categories:delete': admin(S.idInput, async (ctx, { id }) => {
    await deleteCategory(ctx.db, id);
    return null;
  }),
  'menu:list': user(S.listMenuInput, (ctx, input) => listMenuItems(ctx.db, input)),
  'menu:get': user(S.idInput, (ctx, { id }) => getMenuItem(ctx.db, id)),
  'menu:create': admin(S.menuItemInput, (ctx, input) => createMenuItem(ctx.db, input)),
  'menu:update': admin(S.updateMenuItemInput, (ctx, input) => updateMenuItem(ctx.db, input)),
  'menu:delete': admin(S.idInput, (ctx, { id }) => deleteMenuItem(ctx.db, id)),
  'menu:pickImage': admin(S.empty, (ctx) => ctx.services.pickImage()),

  // ── sessions (shifts): any logged-in user runs the day; deleting one is admin-only ─────────
  'sessions:getOpen': user(S.empty, (ctx) => getOpenSession(ctx.db)),
  'sessions:get': user(S.idInput, (ctx, { id }) => getSession(ctx.db, id)),
  'sessions:list': user(S.listSessionsInput, (ctx, input) => listSessions(ctx.db, input)),
  'sessions:pendingCarry': user(S.empty, (ctx) => getPendingCarry(ctx.db)),
  'sessions:open': user(S.openSessionInput, (ctx, input) => openSession(ctx.db, ctx.actor, input)),
  'sessions:update': user(S.updateSessionInput, (ctx, input) => updateOpenSession(ctx.db, input)),
  'sessions:close': user(S.closeSessionInput, (ctx, input) =>
    closeSession(ctx.db, ctx.actor, input),
  ),
  'sessions:delete': admin(S.idInput, async (ctx, { id }) => {
    await deleteSession(ctx.db, id);
    return null;
  }),

  // ── orders & payments ──────────────────────────────────────────────────────────────────────
  'orders:busyTables': user(S.empty, (ctx) => listBusyTables(ctx.db)),
  'orders:getTable': user(S.tableInput, (ctx, { tableNumber }) =>
    getTableOrder(ctx.db, tableNumber),
  ),
  'orders:getByNumber': user(S.orderNumberInput, (ctx, { orderNumber }) =>
    getOrderByNumber(ctx.db, orderNumber),
  ),
  'orders:save': user(S.saveTableOrderInput, (ctx, input) =>
    saveTableOrder(ctx.db, ctx.actor, input),
  ),
  'orders:cancel': user(S.cancelTableOrderInput, (ctx, input) => cancelTableOrder(ctx.db, input)),
  'orders:get': user(S.idInput, (ctx, { id }) => getOrder(ctx.db, id)),
  'orders:openList': user(S.empty, (ctx) => listOpenOrders(ctx.db)),
  'orders:saveOpen': user(S.saveOpenOrderInput, (ctx, input) =>
    saveOpenOrder(ctx.db, ctx.actor, input),
  ),
  'orders:cancelOpen': user(S.orderIdInput, (ctx, input) => cancelOpenOrder(ctx.db, input)),
  'orders:setDeliveryStatus': user(S.deliveryStatusInput, (ctx, input) =>
    setDeliveryStatus(ctx.db, input),
  ),
  'customers:findByPhone': user(S.phoneLookupInput, (ctx, { phone }) =>
    findCustomerByPhone(ctx.db, phone),
  ),
  'payments:pay': user(S.payOrderInput, (ctx, input) => payOrder(ctx.db, ctx.actor, input)),
  'checks:list': user(S.listChecksInput, (ctx, input) => listChecks(ctx.db, input)),
  'checks:update': admin(S.updatePaymentInput, (ctx, input) => updatePayment(ctx.db, input)),
  'checks:delete': admin(S.orderNumberInput, (ctx, { orderNumber }) =>
    cancelPaidOrder(ctx.db, orderNumber),
  ),

  // ── residuals, expenses, reports ───────────────────────────────────────────────────────────
  'residuals:list': user(S.listResidualsInput, (ctx, input) => listResiduals(ctx.db, input)),
  'residuals:apply': user(S.applyResidualsInput, (ctx, input) => applyResiduals(ctx.db, input)),
  'expenses:list': admin(S.listExpensesInput, (ctx, input) => listExpenses(ctx.db, input)),
  'reports:sales': admin(S.salesReportInput, (ctx, input) => salesReport(ctx.db, input)),
};
