import type { z } from 'zod';
import type {
  debtCustomerInput,
  editCheckInput,
  listChecksInput,
  payOrderInput,
} from '@shared/schemas';
import type { CheckDto, OrderDto, OrderPaymentMethod, PaymentMethod } from '@shared/types';
import { dec, toMoneyString, type Dec } from '@shared/utils/decimal';
import { settleTenders, type TenderLine } from '@shared/utils/split-payment';
import { localDate } from '@shared/schemas';
import { assertNotOverpaid, debtCustomerId, reallocate } from '../debts/debts';
import { dayEnd, dayStart, iso, type Actor, type Db, type Tx } from '../domain/db';
import { conflict, invalid, notFound } from '../domain/errors';
import { getOrder } from '../orders/orders';
import { applyStockDeltas } from '../sessions/stock';
import { getSettings } from '../settings/settings';

const SPLIT_PROBLEM: Record<'empty' | 'short' | 'nonCashOver', string> = {
  empty: "To'lov usulini tanlang",
  short: "To'lov summasi yetarli emas",
  nonCashOver:
    'Karta, Click va nasiya jami chek summasidan oshmasligi kerak (qaytim faqat naqddan)',
};

/**
 * Writes an order's payments, one row per method (feature F1-C), inside the caller's transaction:
 * the lines are checked by the same rules the payment modal uses (shared/utils/split-payment.ts);
 * the debt part goes on a customer (given by phone, or the order's own customer for takeaway and
 * delivery) with an optional due date, and their ledger is re-covered. Returns the order's method.
 */
async function writeTenders(
  tx: Tx,
  order: { id: number; totalAmount: { toString(): string }; customerId: number | null },
  tenders: TenderLine[],
  debtCustomer: z.infer<typeof debtCustomerInput> | undefined,
  opts: {
    paidAt: Date;
    /** Who took the payment (a check edit keeps the original cashier). */
    createdById: number | null;
    /** A check edit may keep a split or a debt part the settings no longer offer. */
    keepSplit?: boolean;
    keepDebt?: boolean;
  },
): Promise<OrderPaymentMethod> {
  const split = settleTenders(order.totalAmount.toString(), tenders);
  if (split.problem !== 'none') {
    throw invalid(SPLIT_PROBLEM[split.problem], {
      field: 'tenders',
      reason: split.problem,
      remaining: split.remaining,
    });
  }

  const settings = await getSettings(tx);
  if (split.applied.length > 1 && !settings.splitPaymentEnabled && !opts.keepSplit)
    throw conflict("Bo'lib to'lash sozlamalarda o'chirilgan", { reason: 'SPLIT_DISABLED' });

  let customerId: number | null = null;
  let dueDate: Date | null = null;
  if (split.applied.some((l) => l.method === 'debt')) {
    if (!settings.debtEnabled && !opts.keepDebt)
      throw conflict("Nasiya sozlamalarda o'chirilgan", { reason: 'DEBT_DISABLED' });
    if (debtCustomer) {
      customerId = await debtCustomerId(
        tx,
        debtCustomer.phone,
        debtCustomer.name,
        'debtCustomer.name',
      );
      dueDate = debtCustomer.dueDate ? dayEnd(debtCustomer.dueDate) : null;
    } else if (order.customerId !== null) {
      customerId = order.customerId;
    } else {
      throw invalid('Nasiya uchun mijozning telefon raqami kerak', {
        field: 'debtCustomer.phone',
      });
    }
  }

  for (const line of split.applied) {
    const debt = line.method === 'debt';
    await tx.payment.create({
      data: {
        orderId: order.id,
        amount: line.amount,
        method: line.method,
        status: debt ? 'pending' : 'paid',
        paidAt: opts.paidAt,
        createdById: opts.createdById,
        customerId: debt ? customerId : null,
        dueDate: debt ? dueDate : null,
      },
    });
  }
  if (customerId !== null) await reallocate(tx, customerId);
  return split.applied.length === 1 ? split.applied[0]!.method : 'mixed';
}

/**
 * Pays an unpaid order, in one transaction: its payments and the order's move to `completed`
 * (which releases the table). `tenders` may split it over several methods; the legacy single
 * `method` pays the whole total.
 */
export async function payOrder(
  db: Db,
  actor: Actor,
  input: z.infer<typeof payOrderInput>,
): Promise<OrderDto> {
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw notFound('Buyurtma');
    if (order.status !== 'pending')
      throw conflict('Buyurtma allaqachon yopilgan', { status: order.status });
    if (input.expectedVersion !== undefined && input.expectedVersion !== order.version) {
      throw conflict("Buyurtma boshqa joyda o'zgartirilgan. Qayta oching", {
        reason: 'STALE',
        currentVersion: order.version,
      });
    }

    const tenders: TenderLine[] = input.tenders ?? [
      { method: input.method as TenderLine['method'], amount: order.totalAmount.toString() },
    ];
    // A new debt is not due in the past (a check edit may keep an old due date).
    if (input.debtCustomer?.dueDate && input.debtCustomer.dueDate < localDate())
      throw invalid("Qaytarish muddati o'tib ketgan sana", { field: 'debtCustomer.dueDate' });
    const now = new Date();
    const method = await writeTenders(tx, order, tenders, input.debtCustomer, {
      paidAt: now,
      createdById: actor.id,
    });
    const res = await tx.order.updateMany({
      where: { id: order.id, version: order.version, status: 'pending' },
      data: {
        status: 'completed',
        paymentMethod: method,
        completedAt: now,
        // A delivery is paid when the courier is back with the money.
        ...(order.orderType === 'DELIVERY' ? { deliveryStatus: 'DELIVERED' as const } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1)
      throw conflict("Buyurtma boshqa joyda o'zgartirilgan. Qayta oching", { reason: 'STALE' });
  });
  return getOrder(db, input.orderId);
}

/**
 * The checks (cheklar) list: paid orders with a payment in the local-date range, one row each
 * (a split check sums its payments and lists its methods). Filters: method (any of its payments),
 * status (pending = debt still open), table, order type.
 */
export async function listChecks(
  db: Db,
  input: z.infer<typeof listChecksInput>,
): Promise<CheckDto[]> {
  const rows = await db.payment.findMany({
    where: {
      paidAt: { gte: dayStart(input.startDate), lte: dayEnd(input.endDate) },
      ...(input.tableNumber || input.orderType
        ? {
            order: {
              ...(input.tableNumber
                ? { tableNumber: input.tableNumber, orderType: 'DINE_IN' as const }
                : {}),
              ...(input.orderType ? { orderType: input.orderType } : {}),
            },
          }
        : {}),
    },
    include: {
      order: {
        select: { orderNumber: true, tableNumber: true, orderType: true, customerName: true },
      },
    },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
  });

  type Acc = {
    check: Omit<CheckDto, 'amount' | 'debtAmount' | 'debtOpen' | 'status'>;
    total: Dec;
    debt: Dec;
    open: Dec;
    statuses: Set<string>;
  };
  const byOrder = new Map<number, Acc>();
  for (const p of rows) {
    const acc: Acc = byOrder.get(p.orderId) ?? {
      check: {
        orderId: p.orderId,
        orderNumber: p.order.orderNumber,
        orderType: p.order.orderType,
        tableNumber:
          p.order.orderType === 'DINE_IN' && p.order.tableNumber > 0 ? p.order.tableNumber : null,
        customerName: p.order.customerName,
        methods: [],
        paidAt: iso(p.paidAt),
      },
      total: dec(0),
      debt: dec(0),
      open: dec(0),
      statuses: new Set(),
    };
    const amount = dec(p.amount.toString());
    const method = p.method as PaymentMethod;
    acc.total = acc.total.plus(amount);
    if (!acc.check.methods.includes(method)) acc.check.methods.push(method);
    acc.statuses.add(p.status);
    if (method === 'debt') {
      acc.debt = acc.debt.plus(amount);
      if (p.status === 'pending') acc.open = acc.open.plus(amount);
    }
    byOrder.set(p.orderId, acc);
  }

  const checks: CheckDto[] = [...byOrder.values()]
    .filter((a) => !input.method || a.check.methods.includes(input.method))
    .map(
      (a): CheckDto => ({
        ...a.check,
        amount: toMoneyString(a.total),
        debtAmount: toMoneyString(a.debt),
        debtOpen: toMoneyString(a.open),
        status: a.open.gt(0) ? 'pending' : a.statuses.has('refunded') ? 'refunded' : 'paid',
      }),
    )
    // Filtered on the status the list shows (a split check with open debt is pending).
    .filter((c) => !input.status || c.status === input.status);

  const sign = input.direction === 'asc' ? 1 : -1;
  checks.sort((a, b) => {
    const primary =
      input.sortBy === 'tableNumber'
        ? (a.tableNumber ?? 0) - (b.tableNumber ?? 0)
        : input.sortBy === 'amount'
          ? dec(a.amount).comparedTo(b.amount)
          : a.paidAt.localeCompare(b.paidAt);
    return sign * primary || b.paidAt.localeCompare(a.paidAt);
  });
  return checks;
}

/** Debt customers of an order's payments (to re-cover their ledgers after a change). */
async function debtCustomersOf(tx: Tx, orderId: number): Promise<number[]> {
  const rows = await tx.payment.findMany({
    where: { orderId, method: 'debt', customerId: { not: null } },
    select: { customerId: true },
  });
  return [...new Set(rows.map((r) => r.customerId!))];
}

/**
 * Admin correction of a paid check: its payments are replaced by the given methods, checked like
 * a new payment (they must cover the total; debt needs a customer). The check keeps its date. A
 * change that would leave a customer having repaid more debt than they owe is refused.
 */
export async function editCheck(
  db: Db,
  actor: Actor,
  input: z.infer<typeof editCheckInput>,
): Promise<OrderDto> {
  const id = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber: input.orderNumber },
      include: { payments: { orderBy: { paidAt: 'asc' } } },
    });
    if (!order) throw notFound('Buyurtma');
    if (order.status !== 'completed')
      throw conflict("Faqat to'langan chekni tahrirlash mumkin", { status: order.status });
    if (input.expectedVersion !== undefined && input.expectedVersion !== order.version)
      throw conflict("Chek boshqa joyda o'zgartirilgan. Qayta oching", { reason: 'STALE' });
    // Settled or refunded in the legacy app: rewriting it would make it owed (or paid) again.
    if (
      order.payments.some(
        (p) =>
          p.status === 'refunded' ||
          (p.method === 'debt' && !p.customerId && p.status !== 'pending'),
      )
    ) {
      throw conflict("Eski dasturda yopilgan chekni tahrirlab bo'lmaydi", {
        reason: 'LEGACY_SETTLED',
      });
    }

    const before = await debtCustomersOf(tx, order.id);
    const paidAt = order.payments[0]?.paidAt ?? order.completedAt ?? new Date();
    await tx.payment.deleteMany({ where: { orderId: order.id } });
    const method = await writeTenders(tx, order, input.tenders, input.debtCustomer, {
      paidAt,
      // The cashier who took it stays on record; the edit itself is the admin's.
      createdById: order.payments[0]?.createdById ?? actor.id,
      keepSplit: new Set(order.payments.map((p) => p.method)).size > 1,
      keepDebt: order.payments.some((p) => p.method === 'debt'),
    });
    for (const customerId of before) {
      await assertNotOverpaid(tx, customerId);
      await reallocate(tx, customerId);
    }
    const res = await tx.order.updateMany({
      where: { id: order.id, version: order.version },
      data: { paymentMethod: method, version: { increment: 1 } },
    });
    if (res.count !== 1)
      throw conflict("Chek boshqa joyda o'zgartirilgan. Qayta oching", { reason: 'STALE' });
    return order.id;
  });
  return getOrder(db, id);
}

/**
 * Admin "delete check" (decided 2026-10-18; legacy only deleted the payments and left the order
 * `completed`, quirk 9). In one transaction: the payments are removed, so reports stop counting
 * them, and the order becomes `cancelled`. Its stock goes back to the shift only while that shift
 * is still open; a closed shift's books are final. Its debt leaves the customer's ledger; if they
 * have already repaid more than the debt left after that, it is refused until a repayment is
 * voided (otherwise repayments simply cover their other debts). Unpaid orders are cancelled from
 * their order screen.
 */
export async function cancelPaidOrder(db: Db, orderNumber: string): Promise<OrderDto> {
  const id = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber },
      include: { items: true, session: { select: { status: true } } },
    });
    if (!order) throw notFound('Buyurtma');
    if (order.status === 'cancelled') throw conflict('Buyurtma allaqachon bekor qilingan');
    if (order.status === 'pending') {
      throw conflict("To'lanmagan buyurtmani buyurtma oynasidan bekor qiling", {
        status: order.status,
      });
    }

    const debtors = await debtCustomersOf(tx, order.id);
    await tx.payment.deleteMany({ where: { orderId: order.id } });
    for (const customerId of debtors) {
      await assertNotOverpaid(tx, customerId);
      await reallocate(tx, customerId);
    }

    if (order.session.status === 'open') {
      const deltas = new Map<number, Dec>();
      for (const i of order.items) {
        deltas.set(
          i.menuItemId,
          (deltas.get(i.menuItemId) ?? dec(0)).minus(dec(i.stockQuantity.toString())),
        );
      }
      await applyStockDeltas(tx, order.sessionId, deltas);
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'cancelled', version: { increment: 1 } },
    });
    return order.id;
  });
  return getOrder(db, id);
}
