import type { z } from 'zod';
import type { listChecksInput, payOrderInput, updatePaymentInput } from '@shared/schemas';
import type { CheckDto, OrderDto, PaymentDto } from '@shared/types';
import { dec, type Dec } from '@shared/utils/decimal';
import { decStr, dayEnd, dayStart, iso, type Actor, type Db } from '../domain/db';
import { conflict, notFound } from '../domain/errors';
import { getOrder } from '../orders/orders';
import { applyStockDeltas } from '../sessions/stock';

/**
 * Pays an unpaid order in full, in one transaction: the payment row and the order's move to
 * `completed` (which releases the table, migration 0003). Legacy parity: the amount is the order
 * total and debt ("nasiya") is recorded with status `pending`, everything else `paid`.
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

    const now = new Date();
    await tx.payment.create({
      data: {
        orderId: order.id,
        amount: order.totalAmount,
        method: input.method,
        status: input.method === 'debt' ? 'pending' : 'paid',
        paidAt: now,
        createdById: actor.id,
      },
    });
    const res = await tx.order.updateMany({
      where: { id: order.id, version: order.version, status: 'pending' },
      data: {
        status: 'completed',
        paymentMethod: input.method,
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

/** The checks (cheklar) list: payments in a local-date range with legacy filters and sorting. */
export async function listChecks(
  db: Db,
  input: z.infer<typeof listChecksInput>,
): Promise<CheckDto[]> {
  const dir = input.direction;
  const orderBy =
    input.sortBy === 'tableNumber'
      ? [{ order: { tableNumber: dir } }, { paidAt: 'desc' as const }]
      : input.sortBy === 'amount'
        ? [{ amount: dir }, { paidAt: 'desc' as const }]
        : [{ paidAt: dir }];

  const rows = await db.payment.findMany({
    where: {
      paidAt: { gte: dayStart(input.startDate), lte: dayEnd(input.endDate) },
      ...(input.method ? { method: input.method } : {}),
      ...(input.status ? { status: input.status } : {}),
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
    orderBy,
  });

  return rows.map((p) => ({
    paymentId: p.id,
    orderId: p.orderId,
    orderNumber: p.order.orderNumber,
    orderType: p.order.orderType,
    tableNumber:
      p.order.orderType === 'DINE_IN' && p.order.tableNumber > 0 ? p.order.tableNumber : null,
    customerName: p.order.customerName,
    amount: decStr(p.amount),
    method: p.method,
    status: p.status,
    paidAt: iso(p.paidAt),
  }));
}

/** Admin correction of a check (legacy "edit check"). Keeps the order's method in step. */
export async function updatePayment(
  db: Db,
  input: z.infer<typeof updatePaymentInput>,
): Promise<PaymentDto[]> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { orderNumber: input.orderNumber } });
    if (!order) throw notFound('Buyurtma');
    const res = await tx.payment.updateMany({
      where: { orderId: order.id },
      data: {
        amount: input.amount,
        method: input.method,
        status: input.status,
        paidAt: input.paidAt ? new Date(input.paidAt) : undefined,
      },
    });
    if (res.count === 0) throw notFound("To'lov");
    if (input.method) {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentMethod: input.method, version: { increment: 1 } },
      });
    }
    const payments = await tx.payment.findMany({
      where: { orderId: order.id },
      orderBy: { id: 'asc' },
    });
    return payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: decStr(p.amount),
      method: p.method,
      status: p.status,
      paidAt: iso(p.paidAt),
    }));
  });
}

/**
 * Admin "delete check" (decided 2026-10-18; legacy only deleted the payments and left the order
 * `completed`, quirk 9). In one transaction: the payments are removed, so reports stop counting
 * them, and the order becomes `cancelled`. Its stock goes back to the shift only while that shift
 * is still open; a closed shift's books are final. Unpaid orders are cancelled from the table
 * (orders:cancel), not here.
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

    await tx.payment.deleteMany({ where: { orderId: order.id } });

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
