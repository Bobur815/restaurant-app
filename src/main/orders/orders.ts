import type { z } from 'zod';
import type { SaveTableOrderInput, tableInput } from '@shared/schemas';
import type { OrderDto, TableSummaryDto } from '@shared/types';
import { dec, sum, toMoneyString, toQtyString, type Dec } from '@shared/utils/decimal';
import { LineError, priceLine } from '@shared/utils/order-line';
import { decStr, iso, isoOrNull, type Actor, type Db, type DbOrTx, type Tx } from '../domain/db';
import { conflict, invalid, isUniqueViolation, notFound } from '../domain/errors';
import { requireOpenSessionId } from '../sessions/sessions';
import { applyStockDeltas } from '../sessions/stock';

export const ORDER_COUNTER = 'orders';

const orderInclude = {
  items: {
    include: {
      menuItem: { select: { nameUz: true, nameRu: true, imageFile: true, hasPortions: true } },
    },
    orderBy: { id: 'asc' },
  },
  payments: { orderBy: { id: 'asc' } },
  createdBy: { select: { username: true } },
} as const;

type OrderRow = NonNullable<Awaited<ReturnType<typeof findOrder>>>;

function findOrder(db: DbOrTx, where: { id: number } | { orderNumber: string }) {
  return db.order.findUnique({ where, include: orderInclude });
}

export function toOrderDto(o: OrderRow): OrderDto {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    tableNumber: o.tableNumber,
    status: o.status,
    sessionId: o.sessionId,
    totalAmount: decStr(o.totalAmount),
    paymentMethod: o.paymentMethod,
    version: o.version,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
    completedAt: isoOrNull(o.completedAt),
    createdBy: o.createdBy?.username ?? null,
    lines: o.items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      nameUz: i.menuItem.nameUz,
      nameRu: i.menuItem.nameRu,
      imageFile: i.menuItem.imageFile,
      soldByWeight: i.soldByWeight,
      hasPortions: i.menuItem.hasPortions,
      quantity: decStr(i.quantity),
      portion: decStr(i.portion),
      weightKg: decStr(i.weightKg),
      unitPrice: decStr(i.unitPrice),
      totalPrice: decStr(i.totalPrice),
      stockQuantity: decStr(i.stockQuantity),
    })),
    payments: o.payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: decStr(p.amount),
      method: p.method,
      status: p.status,
      paidAt: iso(p.paidAt),
    })),
  };
}

export async function getOrder(db: DbOrTx, id: number): Promise<OrderDto> {
  const o = await findOrder(db, { id });
  if (!o) throw notFound('Buyurtma');
  return toOrderDto(o);
}

export async function getOrderByNumber(db: DbOrTx, orderNumber: string): Promise<OrderDto> {
  const o = await findOrder(db, { orderNumber });
  if (!o) throw notFound('Buyurtma');
  return toOrderDto(o);
}

/** The table's unpaid order, or null when the table is free. */
export async function getTableOrder(db: DbOrTx, tableNumber: number): Promise<OrderDto | null> {
  const o = await db.order.findUnique({
    where: { pendingTable: tableNumber },
    include: orderInclude,
  });
  return o ? toOrderDto(o) : null;
}

/** Busy tables (one unpaid order each) for the table grid. */
export async function listBusyTables(db: DbOrTx): Promise<TableSummaryDto[]> {
  const rows = await db.order.findMany({
    where: { status: 'pending' },
    include: { _count: { select: { items: true } } },
    orderBy: { tableNumber: 'asc' },
  });
  return rows.map((o) => ({
    tableNumber: o.tableNumber,
    orderId: o.id,
    orderNumber: o.orderNumber,
    totalAmount: decStr(o.totalAmount),
    lineCount: o._count.items,
    updatedAt: iso(o.updatedAt),
  }));
}

/** YYYY-NNNNN (legacy format): the next value of the counter, inside the caller's transaction. */
export async function nextOrderNumber(tx: Tx, now: Date = new Date()): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { name: ORDER_COUNTER },
    update: { value: { increment: 1 } },
    create: { name: ORDER_COUNTER, value: 1 },
  });
  return `${now.getFullYear()}-${String(counter.value).padStart(5, '0')}`;
}

function staleOrder(currentVersion: number | null) {
  return conflict("Buyurtma boshqa joyda o'zgartirilgan. Qayta oching", {
    reason: 'STALE',
    currentVersion,
  });
}

/**
 * Creates or replaces the table's unpaid order, in one transaction with its stock:
 * - every line is priced on the server from the current menu (legacy trusted the client's totals);
 * - the stock change is new stock use minus the old lines' stock use, per dish, applied to the
 *   open shift all-or-nothing (a shortage lists every short dish in details.shortages);
 * - an existing order must be saved with the version the client loaded (another device may have
 *   changed it), a new one with no version.
 */
export async function saveTableOrder(
  db: Db,
  actor: Actor,
  input: SaveTableOrderInput,
): Promise<OrderDto> {
  try {
    const id = await db.$transaction(async (tx) => {
      const sessionId = await requireOpenSessionId(tx);
      const existing = await tx.order.findUnique({
        where: { pendingTable: input.tableNumber },
        include: { items: true },
      });

      if (existing) {
        if (input.expectedVersion !== existing.version) throw staleOrder(existing.version);
        if (existing.sessionId !== sessionId) throw conflict('Buyurtma oldingi smenaga tegishli');
      } else if (input.expectedVersion !== undefined) {
        throw staleOrder(null); // paid or cancelled elsewhere since it was loaded
      }

      const dishIds = [...new Set(input.lines.map((l) => l.menuItemId))];
      const dishes = new Map(
        (await tx.menuItem.findMany({ where: { id: { in: dishIds } } })).map((d) => [d.id, d]),
      );

      const priced = input.lines.map((line, index) => {
        const dish = dishes.get(line.menuItemId);
        if (!dish || !dish.isActive) {
          throw invalid('Taom topilmadi yoki faol emas', {
            lineIndex: index,
            menuItemId: line.menuItemId,
          });
        }
        try {
          const p = priceLine(
            {
              price: dish.price.toString(),
              hasPortions: dish.hasPortions,
              soldByWeight: dish.soldByWeight,
            },
            line,
          );
          return { menuItemId: dish.id, soldByWeight: dish.soldByWeight, ...p };
        } catch (error) {
          if (error instanceof LineError) {
            throw invalid(error.message, {
              lineIndex: index,
              field: error.field,
              menuItemId: dish.id,
            });
          }
          throw error;
        }
      });

      const deltas = new Map<number, Dec>();
      const add = (menuItemId: number, q: Dec) =>
        deltas.set(menuItemId, (deltas.get(menuItemId) ?? dec(0)).plus(q));
      for (const line of priced) add(line.menuItemId, line.stockQuantity);
      for (const old of existing?.items ?? [])
        add(old.menuItemId, dec(old.stockQuantity.toString()).negated());
      await applyStockDeltas(tx, sessionId, deltas);

      const total = toMoneyString(sum(priced.map((l) => l.totalPrice)));
      const lines = priced.map((l) => ({
        menuItemId: l.menuItemId,
        soldByWeight: l.soldByWeight,
        quantity: l.quantity.toFixed(),
        units: l.soldByWeight ? l.quantity.toNumber() : null,
        weightKg: l.weightKg ? toQtyString(l.weightKg) : null,
        portion: l.portion ? l.portion.toFixed() : null,
        unitPrice: l.unitPrice.toFixed(),
        totalPrice: l.totalPrice.toFixed(),
        stockQuantity: l.stockQuantity.toFixed(),
      }));

      if (existing) {
        await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
        // The version condition makes the write itself fail if anything changed it meanwhile.
        const res = await tx.order.updateMany({
          where: { id: existing.id, version: existing.version, status: 'pending' },
          data: { totalAmount: total, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleOrder(null);
        await tx.orderItem.createMany({ data: lines.map((l) => ({ ...l, orderId: existing.id })) });
        return existing.id;
      }

      const order = await tx.order.create({
        data: {
          orderNumber: await nextOrderNumber(tx),
          tableNumber: input.tableNumber,
          sessionId,
          totalAmount: total,
          createdById: actor.id,
          items: { create: lines },
        },
      });
      return order.id;
    });
    return getOrder(db, id);
  } catch (error) {
    // pendingTable is UNIQUE: another device opened this table at the same moment.
    if (isUniqueViolation(error)) throw staleOrder(null);
    throw error;
  }
}

/**
 * Cancels the table's unpaid order and gives its stock back to the shift. The order is kept as
 * `cancelled` (legacy deleted it), so the receipt number is never reused and the history shows it.
 */
export async function cancelTableOrder(
  db: Db,
  input: z.infer<typeof tableInput> & { expectedVersion?: number },
): Promise<OrderDto> {
  const id = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { pendingTable: input.tableNumber },
      include: { items: true, _count: { select: { payments: true } } },
    });
    if (!order) throw notFound('Bekor qilinadigan buyurtma');
    if (input.expectedVersion !== undefined && input.expectedVersion !== order.version) {
      throw staleOrder(order.version);
    }
    if (order._count.payments > 0) throw conflict("To'lovi bor buyurtmani bekor qilib bo'lmaydi");

    const deltas = new Map<number, Dec>();
    for (const i of order.items) {
      deltas.set(
        i.menuItemId,
        (deltas.get(i.menuItemId) ?? dec(0)).minus(dec(i.stockQuantity.toString())),
      );
    }
    await applyStockDeltas(tx, order.sessionId, deltas);

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'cancelled', version: { increment: 1 } },
    });
    return order.id;
  });
  return getOrder(db, id);
}
