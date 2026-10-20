import type { PrismaClient } from '../../generated/prisma-sqlite';
import { dec, toQtyString } from '@shared/utils/decimal';
import { ROLE_DEFAULTS } from '@shared/permissions';
import type { Db, Tx } from '../domain/db';
import { conflict } from '../domain/errors';
import { ensureTablesForOrders } from '../halls/halls';
import { RECEIPT_SETTINGS_ID, setSetting } from '../settings/settings';

/**
 * One-time import of a legacy SavdoChef database (the Express + Prisma app, tag
 * `legacy-js-express`) into a new, empty database. Legacy rows are read with raw SQL, so this
 * does not depend on the legacy Prisma client.
 *
 * Rules:
 * - Money is copied exactly as legacy recorded it (order totals, line prices, payments), even
 *   where legacy's own maths was inconsistent: it is what customers paid.
 * - Legacy passwords are not imported (login is a PIN since F2): users come in without one, and
 *   the one-time "set the administrator PIN" step (auth.ts bootstrapPin) lets the owner in.
 * - Legacy orders had no shift; each goes to the shift whose open..close window contains it.
 * - Each line's stock use is computed with the current rules (portions, kg).
 * - All database writes run in one transaction: the import fully happens or not at all.
 */

type Num = number | string | null;

export interface LegacyData {
  users: Array<{
    id: number;
    username: string;
    full_name: string | null;
    password: string;
    role: string;
    is_active: number | boolean;
    createdAt: Num;
  }>;
  categories: Array<{ id: number; name: string; createdAt: Num }>;
  menus: Array<{
    id: number;
    name: string;
    price: Num;
    imageUrl: string | null;
    description: string | null;
    categoryId: number;
    portions: number | boolean;
    soldByWeight: number | boolean;
    createdAt: Num;
  }>;
  sessions: Array<{ id: number; status: string; closedAt: Num; createdAt: Num }>;
  sessionItems: Array<{
    id: number;
    sessionId: number;
    menuId: number;
    initialQuantity: Num;
    soldQuantity: Num;
  }>;
  orders: Array<{
    id: number;
    orderNumber: string | null;
    tableNumber: number | null;
    orderDate: Num;
    totalAmount: Num;
    status: string;
    paymentMethod: string | null;
    updateDate: Num;
  }>;
  orderItems: Array<{
    id: number;
    orderId: number;
    menuId: number;
    soldByWeight: number | boolean;
    quantity: Num;
    units: number | null;
    weightKg: Num;
    portions: Num;
    unitPrice: Num;
    totalPrice: Num;
  }>;
  payments: Array<{
    id: number;
    orderId: number;
    amount: Num;
    paymentDate: Num;
    paymentMethod: string;
    status: string;
  }>;
  expenses: Array<{
    id: number;
    sessionId: number | null;
    menuId: number | null;
    type: string;
    note: string | null;
    quantity: Num;
    unitCost: Num;
    amount: Num;
    createdAt: Num;
  }>;
  residuals: Array<{
    id: number;
    sessionId: number;
    menuId: number;
    quantity: Num;
    action: string;
    status: string;
    appliedToSession: number | null;
    expenseId: number | null;
    note: string | null;
    createdAt: Num;
  }>;
  receipt: Array<Record<string, unknown>>;
  counters: Array<{ id: string; seq: number }>;
}

const TABLES: Record<keyof LegacyData, string> = {
  users: 'User',
  categories: 'Category',
  menus: 'Menu',
  sessions: 'Session',
  sessionItems: 'SessionItem',
  orders: 'Order',
  orderItems: 'OrderItem',
  payments: 'Payment',
  expenses: 'Expense',
  residuals: 'Residual',
  receipt: 'RecieptSettings',
  counters: 'Counter',
};

/** Reads every legacy table that exists (a missing table reads as empty). Read-only queries. */
export async function readLegacy(legacy: PrismaClient): Promise<LegacyData> {
  const present = new Set(
    (
      await legacy.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
    ).map((r) => r.name),
  );
  const out: Record<string, unknown[]> = {};
  for (const [key, table] of Object.entries(TABLES)) {
    out[key] = present.has(table)
      ? await legacy.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY 1`)
      : [];
  }
  if (!present.has('Menu') || !present.has('Order')) {
    throw new Error('This does not look like a legacy SavdoChef database (no Menu/Order tables).');
  }
  return out as unknown as LegacyData;
}

export interface ImportReport {
  categories: { created: number; reused: number };
  menuItems: number;
  images: { copied: number; missing: string[] };
  users: number;
  sessions: number;
  sessionItems: number;
  orders: number;
  orderItems: number;
  payments: number;
  expenses: number;
  residuals: number;
  receiptSettings: boolean;
  paymentsTotal: string;
  warnings: string[];
  dryRun: boolean;
}

export interface ImportOptions {
  /** Copies a legacy picture into the app's image store; returns the new file name, or null if missing. */
  copyImage?: (legacyFileName: string) => string | null;
  /** Do everything, then roll back. */
  dryRun?: boolean;
}

// ── value helpers ─────────────────────────────────────────────────────────────────────────

const decOr0 = (v: Num) =>
  v === null || v === undefined || v === '' ? '0' : dec(String(v)).toFixed();
const decOrNull = (v: Num) =>
  v === null || v === undefined || v === '' ? null : dec(String(v)).toFixed();
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const date = (v: Num): Date =>
  new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : (v as number | string));
const dateOrNull = (v: Num) => (v === null || v === undefined ? null : date(v));

const METHODS = new Set(['cash', 'card', 'click', 'debt']);
function method(raw: string | null): 'cash' | 'card' | 'click' | 'debt' | null {
  const m = String(raw ?? '').toLowerCase();
  const normal = m === 'klik' ? 'click' : m === 'nasiya' || m === 'credit' ? 'debt' : m;
  return METHODS.has(normal) ? (normal as 'cash' | 'card' | 'click' | 'debt') : null;
}

class DryRunRollback extends Error {}

export async function importLegacy(
  db: Db,
  legacy: LegacyData,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const [users, menu, orders, sessions] = await Promise.all([
    db.user.count(),
    db.menuItem.count(),
    db.order.count(),
    db.session.count(),
  ]);
  if (users + menu + orders + sessions > 0) {
    throw conflict('Import only into an empty database (no users, dishes, orders or shifts yet)', {
      users,
      menu,
      orders,
      sessions,
    });
  }

  const report: ImportReport = {
    categories: { created: 0, reused: 0 },
    menuItems: 0,
    images: { copied: 0, missing: [] },
    users: 0,
    sessions: 0,
    sessionItems: 0,
    orders: 0,
    orderItems: 0,
    payments: 0,
    expenses: 0,
    residuals: 0,
    receiptSettings: false,
    paymentsTotal: '0',
    warnings: [],
    dryRun: !!options.dryRun,
  };

  // Pictures first (files, outside the transaction); skipped in a dry run.
  const imageFor = new Map<number, string | null>();
  for (const m of legacy.menus) {
    if (!m.imageUrl) continue;
    const name = m.imageUrl.split(/[\\/]/).pop()!;
    if (options.dryRun || !options.copyImage) {
      imageFor.set(m.id, null);
      continue;
    }
    const stored = options.copyImage(name);
    if (stored) report.images.copied++;
    else report.images.missing.push(name);
    imageFor.set(m.id, stored);
  }

  try {
    await db.$transaction(
      async (tx) => {
        await importRows(tx, legacy, report, imageFor);
        // Every table an imported order used must exist (feature F1-A halls).
        await ensureTablesForOrders(tx);
        if (options.dryRun) throw new DryRunRollback();
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return report;
}

async function importRows(
  tx: Tx,
  legacy: LegacyData,
  report: ImportReport,
  imageFor: Map<number, string | null>,
): Promise<void> {
  // Categories: reuse the seeded ones with the same name.
  const categoryId = new Map<number, number>();
  for (const c of legacy.categories) {
    const existing = await tx.category.findUnique({ where: { nameUz: c.name } });
    if (existing) {
      categoryId.set(c.id, existing.id);
      report.categories.reused++;
    } else {
      const created = await tx.category.create({
        data: { nameUz: c.name, createdAt: date(c.createdAt) },
      });
      categoryId.set(c.id, created.id);
      report.categories.created++;
    }
  }

  // Dishes.
  const menuId = new Map<number, number>();
  const menuKind = new Map<number, { hasPortions: boolean; soldByWeight: boolean }>();
  for (const m of legacy.menus) {
    const catId = categoryId.get(m.categoryId);
    if (catId === undefined)
      throw new Error(`Menu ${m.id} "${m.name}" points to missing category ${m.categoryId}`);
    const kind = {
      soldByWeight: bool(m.soldByWeight),
      hasPortions: bool(m.portions) && !bool(m.soldByWeight),
    };
    if (bool(m.portions) && bool(m.soldByWeight)) {
      report.warnings.push(
        `"${m.name}": legacy had both portions and by-weight; imported as by-weight`,
      );
    }
    const created = await tx.menuItem.create({
      data: {
        nameUz: m.name,
        description: m.description || null,
        price: decOr0(m.price),
        imageFile: imageFor.get(m.id) ?? null,
        categoryId: catId,
        ...kind,
        createdAt: date(m.createdAt),
      },
    });
    menuId.set(m.id, created.id);
    menuKind.set(m.id, kind);
    report.menuItems++;
  }
  const dish = (legacyId: number, what: string) => {
    const id = menuId.get(legacyId);
    if (id === undefined) throw new Error(`${what} points to missing dish ${legacyId}`);
    return id;
  };

  // Users: name and role (permissions from the role); no password, no PIN, no phone yet.
  for (const u of legacy.users) {
    const role = u.role === 'ADMIN' ? 'ADMIN' : 'STAFF';
    await tx.user.create({
      data: {
        fullName: u.full_name?.trim() || u.username,
        role,
        permissions: JSON.stringify(ROLE_DEFAULTS[role]),
        isActive: bool(u.is_active),
        createdAt: date(u.createdAt),
      },
    });
    report.users++;
  }

  // Receipt settings (legacy singleton), then mark setup complete when there is also an admin.
  const r = legacy.receipt[0];
  if (r) {
    const data = {
      restaurantName: String(r['restaurantName'] ?? 'SavdoChef'),
      address: String(r['address'] ?? ''),
      phone: String(r['phone'] ?? ''),
      extraPhones: String(r['extraPhones'] ?? ''),
      footerNote: String(r['footerNote'] ?? ''),
      locale: String(r['locale'] ?? 'uz').startsWith('ru') ? 'ru' : 'uz',
      currency: String(r['currency'] ?? 'UZS'),
      printWidthPx: Number(r['print_widthPx'] ?? 420),
      printUseStarsSep: bool(r['print_useStarsSep'] ?? 1),
      printSeparatorChar: String(r['print_separatorChar'] ?? '*').slice(0, 1) || '*',
      printSeparatorCount: Number(r['print_separatorCount'] ?? 38),
      printShowAddress: bool(r['print_showAddress'] ?? 1),
      printShowPhone: bool(r['print_showPhone'] ?? 1),
      printShowDateTime: bool(r['print_showDateTime'] ?? 1),
      printShowOrderNumber: bool(r['print_showOrderNumber'] ?? 1),
    };
    await tx.receiptSettings.upsert({
      where: { id: RECEIPT_SETTINGS_ID },
      update: data,
      create: { id: RECEIPT_SETTINGS_ID, ...data },
    });
    report.receiptSettings = true;
  }
  if (r && legacy.users.some((u) => u.role === 'ADMIN'))
    await setSetting(tx, 'setupComplete', true);

  // Shifts. At most one may be open (DB-enforced); any extra open legacy shift is imported closed.
  const sessionId = new Map<number, number>();
  const windows: Array<{ id: number; from: number; to: number }> = [];
  let openTaken = false;
  for (const s of [...legacy.sessions].sort(
    (a, b) => date(a.createdAt).getTime() - date(b.createdAt).getTime(),
  )) {
    let open = s.status === 'open';
    if (open && openTaken) {
      open = false;
      report.warnings.push(`Shift ${s.id}: more than one open shift in legacy; imported as closed`);
    }
    openTaken ||= open;
    const created = await tx.session.create({
      data: {
        status: open ? 'open' : 'closed',
        openedAt: date(s.createdAt),
        closedAt: open ? null : (dateOrNull(s.closedAt) ?? date(s.createdAt)),
      },
    });
    sessionId.set(s.id, created.id);
    windows.push({
      id: created.id,
      from: date(s.createdAt).getTime(),
      to: open ? Number.POSITIVE_INFINITY : (dateOrNull(s.closedAt) ?? date(s.createdAt)).getTime(),
    });
    report.sessions++;
  }
  for (const si of legacy.sessionItems) {
    const sid = sessionId.get(si.sessionId);
    if (sid === undefined) continue;
    await tx.sessionItem.create({
      data: {
        sessionId: sid,
        menuItemId: dish(si.menuId, `Shift item ${si.id}`),
        initialQuantity: decOr0(si.initialQuantity),
        soldQuantity: decOr0(si.soldQuantity),
      },
    });
    report.sessionItems++;
  }

  // Orders: legacy had no shift link; use the shift whose window contains the order, else the
  // last shift opened before it, else one closed "import" shift covering all orders.
  let fallbackSession: number | null = null;
  const shiftFor = async (when: number): Promise<number> => {
    const inside = windows.find((w) => when >= w.from && when <= w.to);
    if (inside) return inside.id;
    const before = windows.filter((w) => w.from <= when).sort((a, b) => b.from - a.from)[0];
    if (before) return before.id;
    if (windows[0]) return windows[0].id;
    if (fallbackSession === null) {
      const times = legacy.orders.map((o) => date(o.orderDate).getTime());
      const created = await tx.session.create({
        data: {
          status: 'closed',
          openedAt: new Date(Math.min(...times)),
          closedAt: new Date(Math.max(...times)),
        },
      });
      fallbackSession = created.id;
      report.sessions++;
      report.warnings.push('Legacy had no shifts; orders were put into one closed "import" shift');
    }
    return fallbackSession;
  };

  const orderId = new Map<number, number>();
  for (const o of legacy.orders) {
    const status = o.status === 'pending' || o.status === 'cancelled' ? o.status : 'completed';
    const created = await tx.order.create({
      data: {
        orderNumber: o.orderNumber ?? `LEGACY-${o.id}`,
        tableNumber: o.tableNumber ?? 0,
        status,
        sessionId: await shiftFor(date(o.orderDate).getTime()),
        totalAmount: decOr0(o.totalAmount),
        paymentMethod: method(o.paymentMethod),
        createdAt: date(o.orderDate),
        completedAt: status === 'completed' ? dateOrNull(o.updateDate) : null,
      },
    });
    orderId.set(o.id, created.id);
    report.orders++;
  }

  for (const it of legacy.orderItems) {
    const oid = orderId.get(it.orderId);
    if (oid === undefined) {
      report.warnings.push(`Order line ${it.id} belongs to missing order ${it.orderId}; skipped`);
      continue;
    }
    const kind = menuKind.get(it.menuId);
    const soldByWeight = bool(it.soldByWeight);
    const quantity = dec(decOr0(it.quantity));
    const weightKg = soldByWeight ? decOrNull(it.weightKg) : null;
    const portion = !soldByWeight && kind?.hasPortions ? (decOrNull(it.portions) ?? '1') : null;
    const stock = soldByWeight
      ? quantity.times(weightKg ?? '0')
      : portion
        ? quantity.times(portion)
        : quantity;
    await tx.orderItem.create({
      data: {
        orderId: oid,
        menuItemId: dish(it.menuId, `Order line ${it.id}`),
        soldByWeight,
        quantity: quantity.toFixed(),
        units: soldByWeight ? (it.units ?? Number(quantity.toFixed())) : null,
        weightKg,
        portion,
        unitPrice: decOr0(it.unitPrice),
        totalPrice: decOr0(it.totalPrice),
        stockQuantity: toQtyString(stock),
      },
    });
    report.orderItems++;
  }

  let paid = dec(0);
  for (const p of legacy.payments) {
    const oid = orderId.get(p.orderId);
    const m = method(p.paymentMethod);
    if (oid === undefined || m === null) {
      report.warnings.push(
        `Payment ${p.id}: missing order or unknown method "${p.paymentMethod}"; skipped`,
      );
      continue;
    }
    const status = p.status === 'pending' || p.status === 'refunded' ? p.status : 'paid';
    await tx.payment.create({
      data: {
        orderId: oid,
        amount: decOr0(p.amount),
        method: m,
        status,
        paidAt: date(p.paymentDate),
      },
    });
    paid = paid.plus(decOr0(p.amount));
    report.payments++;
  }
  report.paymentsTotal = paid.toFixed();
  const unpaid = legacy.orders.filter(
    (o) => o.status === 'completed' && !legacy.payments.some((p) => p.orderId === o.id),
  );
  if (unpaid.length) {
    report.warnings.push(
      `${unpaid.length} completed order(s) without a payment (legacy "delete check" removed it): ${unpaid
        .map((o) => o.orderNumber)
        .join(', ')}`,
    );
  }

  const expenseId = new Map<number, number>();
  for (const e of legacy.expenses) {
    const type = e.type === 'waste' || e.type === 'breakage' ? e.type : 'residual_writeoff';
    const created = await tx.expense.create({
      data: {
        sessionId: e.sessionId !== null ? (sessionId.get(e.sessionId) ?? null) : null,
        menuItemId: e.menuId !== null ? (menuId.get(e.menuId) ?? null) : null,
        type,
        note: e.note ?? '',
        quantity: decOr0(e.quantity),
        unitCost: decOr0(e.unitCost),
        amount: decOr0(e.amount),
        createdAt: date(e.createdAt),
      },
    });
    expenseId.set(e.id, created.id);
    report.expenses++;
  }

  const seen = new Set<string>();
  for (const res of legacy.residuals) {
    const sid = sessionId.get(res.sessionId);
    if (sid === undefined) continue;
    const action = res.action === 'WRITE_OFF' ? 'WRITE_OFF' : 'CARRY_TO_NEXT';
    const key = `${sid}|${res.menuId}|${action}`;
    if (seen.has(key)) {
      report.warnings.push(
        `Leftover ${res.id}: duplicate for the same shift, dish and action; skipped`,
      );
      continue;
    }
    seen.add(key);
    await tx.residual.create({
      data: {
        sessionId: sid,
        menuItemId: dish(res.menuId, `Leftover ${res.id}`),
        quantity: decOr0(res.quantity),
        action,
        status: res.status === 'applied' ? 'applied' : 'pending',
        appliedToSessionId:
          res.appliedToSession !== null ? (sessionId.get(res.appliedToSession) ?? null) : null,
        expenseId: res.expenseId !== null ? (expenseId.get(res.expenseId) ?? null) : null,
        note: res.note ?? '',
        createdAt: date(res.createdAt),
      },
    });
    report.residuals++;
  }

  // Order numbers continue after legacy's.
  const legacySeq = legacy.counters.find((c) => c.id === 'orders')?.seq ?? 0;
  const current = await tx.counter.findUnique({ where: { name: 'orders' } });
  if (legacySeq > (current?.value ?? 0)) {
    await tx.counter.upsert({
      where: { name: 'orders' },
      update: { value: legacySeq },
      create: { name: 'orders', value: legacySeq },
    });
  }
}
