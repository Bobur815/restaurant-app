import type { z } from 'zod';
import * as S from '@shared/schemas';
import type { IpcChannel } from '@shared/ipc';
import {
  bootstrapPin,
  bootstrapStatus,
  hasRecoveryCode,
  newRecoveryCode,
  pinLogin,
  recoverWithCode,
} from '../auth/auth';
import { hasPermission, type Permission } from '@shared/permissions';
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
import { cancelPaidOrder, editCheck, listChecks, payOrder } from '../payments/payments';
import {
  assignDebt,
  getDebtor,
  listDebtors,
  repayDebt,
  updateCustomer,
  voidRepayment,
  writeOffDebt,
} from '../debts/debts';
import { getReceiptLayouts, updateReceiptLayout } from '../printing/layouts';
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
import { createUser, listUsers, updateProfile, updateUser } from '../users/users';
import { forbidden } from '../domain/errors';
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
/** Needs a permission (shared/permissions.ts); checked in invokeHandler on every call. */
const need = <C extends IpcChannel, Sc extends z.ZodType>(
  access: Permission,
  input: Sc,
  run: HandlerDef<C, Sc>['run'],
) => ({ access, input, run }) as HandlerDef<C, Sc>;

/**
 * Every channel in shared/ipc.ts, with who may call it. The mapped type makes a missing or
 * extra channel a compile error. Handlers stay thin: parse (done by invokeHandler), call the
 * domain module, return its DTO.
 */
export const HANDLERS: { [C in IpcChannel]: AnyHandlerDef<C> } = {
  'app:info': pub(S.empty, async (ctx) => ctx.services.appInfo()),

  // ── auth & users (feature F2: PIN-only login) ─────────────────────────────────────────────
  'auth:pinLogin': pub(S.pinLoginInput, async (ctx, { pin }) => {
    const user = await pinLogin(ctx.db, pin);
    ctx.setActor(user);
    return user;
  }),
  'auth:logout': pub(S.empty, async (ctx) => {
    ctx.setActor(null);
    return null;
  }),
  'auth:me': pub(S.empty, async (ctx) => ctx.actor),
  'auth:recover': pub(S.recoverInput, async (ctx, input) => {
    const result = await recoverWithCode(ctx.db, input);
    ctx.setActor(result.user);
    return result;
  }),
  'auth:bootstrapStatus': pub(S.empty, (ctx) => bootstrapStatus(ctx.db)),
  'auth:bootstrapPin': pub(S.bootstrapPinInput, async (ctx, input) => {
    const result = await bootstrapPin(ctx.db, input);
    ctx.setActor(result.user);
    return result;
  }),
  'auth:recoveryStatus': need('users', S.empty, async (ctx) => ({
    hasCode: await hasRecoveryCode(ctx.db),
  })),
  'auth:newRecoveryCode': need('users', S.empty, async (ctx) => ({
    recoveryCode: await newRecoveryCode(ctx.db),
  })),
  'users:list': need('users', S.empty, (ctx) => listUsers(ctx.db)),
  'users:create': need('users', S.createUserInput, (ctx, input) => createUser(ctx.db, input)),
  'users:update': need('users', S.updateUserInput, (ctx, input) =>
    updateUser(ctx.db, ctx.actor, input),
  ),
  'users:updateProfile': user(S.updateProfileInput, async (ctx, input) => {
    const user = await updateProfile(ctx.db, ctx.actor, input);
    ctx.setActor(user);
    return user;
  }),

  // ── setup & settings ───────────────────────────────────────────────────────────────────────
  'setup:status': pub(S.empty, (ctx) => getSetupStatus(ctx.db)),
  // Public by necessity (no users exist yet); completeSetup refuses once any admin exists.
  'setup:complete': pub(S.setupInput, async (ctx, input) => {
    const result = await completeSetup(ctx.db, input);
    ctx.setActor(result.user);
    return result;
  }),
  // Public: the login screen needs language, theme and the restaurant name.
  'settings:get': pub(S.empty, (ctx) => getSettings(ctx.db)),
  'settings:update': need('settings', S.updateSettingsInput, (ctx, input) =>
    updateSettings(ctx.db, input),
  ),
  'receipt:get': pub(S.empty, (ctx) => getReceiptSettings(ctx.db)),
  'receipt:update': need('settings', S.updateReceiptSettingsInput, (ctx, input) =>
    updateReceiptSettings(ctx.db, input),
  ),
  // Layouts per order type (feature F3): General, takeaway, delivery.
  'receipt:layouts': need('settings', S.empty, (ctx) => getReceiptLayouts(ctx.db)),
  'receipt:updateLayout': need('settings', S.updateReceiptLayoutInput, (ctx, input) =>
    updateReceiptLayout(ctx.db, input),
  ),
  'receipt:pickImage': need('settings', S.empty, (ctx) => ctx.services.pickImage()),

  // ── software update (feature F4) ──────────────────────────────────────────────────────────
  'updater:status': need('settings', S.empty, async (ctx) => ctx.services.updater.status()),
  'updater:check': need('settings', S.empty, (ctx) => ctx.services.updater.check()),
  'updater:download': need('settings', S.empty, async (ctx) => ctx.services.updater.download()),
  'updater:install': need('settings', S.empty, async (ctx) => {
    await ctx.services.updater.install();
    return null;
  }),

  // ── printing ─────────────────────────────────────────────────────────────────────────────
  'printing:printers': need('settings', S.empty, (ctx) => ctx.services.printer.list()),
  'printing:printReceipt': user(S.printReceiptInput, (ctx, { orderId }) =>
    printOrderReceipt(ctx.db, ctx.services.printer, orderId, ctx.services.receiptImage),
  ),
  'printing:test': need('settings', S.testPrintInput, (ctx, { orderType }) =>
    printTestReceipt(ctx.db, ctx.services.printer, orderType, ctx.services.receiptImage),
  ),
  'printing:preview': need('settings', S.previewReceiptInput, (ctx, input) =>
    previewReceipt(ctx.db, ctx.services.printer, input, ctx.services.receiptImage),
  ),

  // ── halls & tables ───────────────────────────────────────────────────────────────────────
  // Hidden halls and tables are for the settings page (admins); everyone else sees active ones.
  'halls:list': user(S.listHallsInput, (ctx, input) =>
    listHalls(ctx.db, {
      includeInactive: input.includeInactive && hasPermission(ctx.actor, 'settings'),
    }),
  ),
  'halls:create': need('settings', S.hallInput, (ctx, input) => createHall(ctx.db, input)),
  'halls:update': need('settings', S.updateHallInput, (ctx, input) => updateHall(ctx.db, input)),
  'halls:reorder': need('settings', S.reorderHallsInput, (ctx, { ids }) =>
    reorderHalls(ctx.db, ids),
  ),
  'halls:delete': need('settings', S.idInput, async (ctx, { id }) => {
    await deleteHall(ctx.db, id);
    return null;
  }),
  'tables:create': need('settings', S.diningTableInput, (ctx, input) => createTable(ctx.db, input)),
  'tables:createRange': need('settings', S.tableRangeInput, (ctx, input) =>
    createTableRange(ctx.db, input),
  ),
  'tables:update': need('settings', S.updateDiningTableInput, (ctx, input) =>
    updateTable(ctx.db, input),
  ),
  'tables:delete': need('settings', S.idInput, async (ctx, { id }) => {
    await deleteTable(ctx.db, id);
    return null;
  }),

  // ── menu ───────────────────────────────────────────────────────────────────────────────────
  'categories:list': user(S.listCategoriesInput, (ctx, input) => listCategories(ctx.db, input)),
  'categories:create': need('menu', S.categoryInput, (ctx, input) => createCategory(ctx.db, input)),
  'categories:update': need('menu', S.updateCategoryInput, (ctx, input) =>
    updateCategory(ctx.db, input),
  ),
  'categories:delete': need('menu', S.idInput, async (ctx, { id }) => {
    await deleteCategory(ctx.db, id);
    return null;
  }),
  'menu:list': user(S.listMenuInput, (ctx, input) => listMenuItems(ctx.db, input)),
  'menu:get': user(S.idInput, (ctx, { id }) => getMenuItem(ctx.db, id)),
  'menu:create': need('menu', S.menuItemInput, (ctx, input) => createMenuItem(ctx.db, input)),
  'menu:update': need('menu', S.updateMenuItemInput, (ctx, input) => updateMenuItem(ctx.db, input)),
  'menu:delete': need('menu', S.idInput, (ctx, { id }) => deleteMenuItem(ctx.db, id)),
  'menu:pickImage': need('menu', S.empty, (ctx) => ctx.services.pickImage()),

  // ── sessions (shifts): any logged-in user runs the day; deleting one is admin-only ─────────
  'sessions:getOpen': user(S.empty, (ctx) => getOpenSession(ctx.db)),
  'sessions:get': user(S.idInput, (ctx, { id }) => getSession(ctx.db, id)),
  'sessions:list': user(S.listSessionsInput, (ctx, input) => listSessions(ctx.db, input)),
  'sessions:pendingCarry': user(S.empty, (ctx) => getPendingCarry(ctx.db)),
  'sessions:open': need('shifts', S.openSessionInput, (ctx, input) =>
    openSession(ctx.db, ctx.actor, input),
  ),
  'sessions:update': need('shifts', S.updateSessionInput, (ctx, input) =>
    updateOpenSession(ctx.db, input),
  ),
  'sessions:close': need('shifts', S.closeSessionInput, (ctx, input) =>
    closeSession(ctx.db, ctx.actor, input),
  ),
  'sessions:delete': need('corrections', S.idInput, async (ctx, { id }) => {
    await deleteSession(ctx.db, id);
    return null;
  }),

  // ── orders & payments ──────────────────────────────────────────────────────────────────────
  'orders:busyTables': user(S.empty, (ctx) => listBusyTables(ctx.db)),
  'orders:getTable': user(S.tableInput, (ctx, { tableNumber }) =>
    getTableOrder(ctx.db, tableNumber),
  ),
  'orders:getByNumber': need('checks', S.orderNumberInput, (ctx, { orderNumber }) =>
    getOrderByNumber(ctx.db, orderNumber),
  ),
  'orders:save': need('orders', S.saveTableOrderInput, (ctx, input) =>
    saveTableOrder(ctx.db, ctx.actor, input),
  ),
  'orders:cancel': need('orders', S.cancelTableOrderInput, (ctx, input) =>
    cancelTableOrder(ctx.db, input),
  ),
  'orders:get': need('orders', S.idInput, (ctx, { id }) => getOrder(ctx.db, id)),
  'orders:openList': need('orders', S.empty, (ctx) => listOpenOrders(ctx.db)),
  'orders:saveOpen': need('orders', S.saveOpenOrderInput, (ctx, input) =>
    saveOpenOrder(ctx.db, ctx.actor, input),
  ),
  'orders:cancelOpen': need('orders', S.orderIdInput, (ctx, input) =>
    cancelOpenOrder(ctx.db, input),
  ),
  'orders:setDeliveryStatus': need('orders', S.deliveryStatusInput, (ctx, input) =>
    setDeliveryStatus(ctx.db, input),
  ),
  'customers:findByPhone': need('orders', S.phoneLookupInput, (ctx, { phone }) =>
    findCustomerByPhone(ctx.db, phone),
  ),
  'payments:pay': need('payments', S.payOrderInput, (ctx, input) => {
    // Selling on debt is its own permission (a cashier may take payments but not give credit).
    const debt = input.method === 'debt' || (input.tenders ?? []).some((t) => t.method === 'debt');
    if (debt && !hasPermission(ctx.actor, 'debt')) throw forbidden("Nasiyaga sotishga ruxsat yo'q");
    return payOrder(ctx.db, ctx.actor, input);
  }),
  'checks:list': need('checks', S.listChecksInput, (ctx, input) => listChecks(ctx.db, input)),
  'checks:update': need('corrections', S.editCheckInput, (ctx, input) =>
    editCheck(ctx.db, ctx.actor, input),
  ),
  'checks:delete': need('corrections', S.orderNumberInput, (ctx, { orderNumber }) =>
    cancelPaidOrder(ctx.db, orderNumber),
  ),

  // ── debt (nasiya) ────────────────────────────────────────────────────────────────────────
  // Debtors who owe nothing now (a directory of past customers) only for admins.
  'debts:list': need('debt', S.listDebtorsInput, (ctx, input) =>
    listDebtors(ctx.db, {
      ...input,
      includeSettled: input.includeSettled && hasPermission(ctx.actor, 'debtsAdmin'),
    }),
  ),
  'debts:get': need('debt', S.debtorInput, (ctx, { customerId }) =>
    getDebtor(ctx.db, customerId, { full: hasPermission(ctx.actor, 'debtsAdmin') }),
  ),
  'debts:repay': need('debt', S.repayInput, (ctx, input) => repayDebt(ctx.db, ctx.actor, input)),
  'debts:writeOff': need('debtsAdmin', S.writeOffInput, (ctx, input) =>
    writeOffDebt(ctx.db, ctx.actor, input),
  ),
  'debts:void': need('debtsAdmin', S.voidRepaymentInput, (ctx, input) =>
    voidRepayment(ctx.db, ctx.actor, input),
  ),
  'debts:assign': need('debtsAdmin', S.assignDebtInput, (ctx, input) => assignDebt(ctx.db, input)),
  'customers:update': need('debtsAdmin', S.updateCustomerInput, (ctx, input) =>
    updateCustomer(ctx.db, input),
  ),

  // ── residuals, expenses, reports ───────────────────────────────────────────────────────────
  'residuals:list': user(S.listResidualsInput, (ctx, input) => listResiduals(ctx.db, input)),
  'residuals:apply': need('shifts', S.applyResidualsInput, (ctx, input) =>
    applyResiduals(ctx.db, input),
  ),
  'expenses:list': need('reports', S.listExpensesInput, (ctx, input) =>
    listExpenses(ctx.db, input),
  ),
  'reports:sales': need('reports', S.salesReportInput, (ctx, input) => salesReport(ctx.db, input)),
};
