import type { z } from 'zod';
import type {
  deliveryStatusInput,
  orderIdInput,
  SaveOpenOrderInput,
  SaveTableOrderInput,
  tableInput,
} from '@shared/schemas';
import type { OpenOrderSummaryDto, OrderDto, PaymentMethod, TableSummaryDto } from '@shared/types';
import { dec, roundMoney, sum, toMoneyString, toQtyString, type Dec } from '@shared/utils/decimal';
import { LineError, priceLine } from '@shared/utils/order-line';
import { decStr, iso, isoOrNull, type Actor, type Db, type DbOrTx, type Tx } from '../domain/db';
import { conflict, invalid, isUniqueViolation, notFound } from '../domain/errors';
import { upsertCustomer } from '../customers/customers';
import { requireOpenSessionId } from '../sessions/sessions';
import { getSettings } from '../settings/settings';
import { applyStockDeltas } from '../sessions/stock';

export const ORDER_COUNTER = 'orders';

const orderInclude = {
  items: {
    include: {
      menuItem: { select: { nameUz: true, nameRu: true, imageFile: true, hasPortions: true } },
    },
    orderBy: { id: 'asc' },
  },
  payments: { orderBy: { id: 'asc' }, include: { customer: { select: { name: true } } } },
  createdBy: { select: { fullName: true } },
} as const;

type OrderRow = NonNullable<Awaited<ReturnType<typeof findOrder>>>;

function findOrder(db: DbOrTx, where: { id: number } | { orderNumber: string }) {
  return db.order.findUnique({ where, include: orderInclude });
}

export function toOrderDto(o: OrderRow): OrderDto {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    orderType: o.orderType,
    // Takeaway/delivery store 0 (the column is NOT NULL); legacy orders without a table too.
    tableNumber: o.orderType === 'DINE_IN' && o.tableNumber > 0 ? o.tableNumber : null,
    status: o.status,
    sessionId: o.sessionId,
    totalAmount: decStr(o.totalAmount),
    paymentMethod: o.paymentMethod,
    version: o.version,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
    completedAt: isoOrNull(o.completedAt),
    createdBy: o.createdBy?.fullName ?? null,
    customerId: o.customerId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    deliveryAddress: o.deliveryAddress,
    deliveryNote: o.deliveryNote,
    deliveryFee: decStr(o.deliveryFee),
    deliveryStatus: o.deliveryStatus,
    courierName: o.courierName,
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
      // Payment rows never hold `mixed` (only the order does).
      method: p.method as PaymentMethod,
      status: p.status,
      paidAt: iso(p.paidAt),
      customerId: p.customerId,
      customerName: p.customer?.name ?? null,
      dueDate: isoOrNull(p.dueDate),
      settledAt: isoOrNull(p.settledAt),
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
    where: { status: 'pending', orderType: 'DINE_IN' },
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

type LineInput = SaveTableOrderInput['lines'][number];
type ItemRow = { menuItemId: number; stockQuantity: { toString(): string } };

/**
 * The common core of saving any order, inside the caller's transaction:
 * - every line is priced on the server from the current menu (legacy trusted the client's totals);
 * - the stock change is new stock use minus the old lines' stock use, per dish, applied to the
 *   open shift all-or-nothing (a shortage lists every short dish in details.shortages).
 * Returns the order_items rows to write and the lines' total (before any delivery fee).
 */
async function priceAndReserve(
  tx: Tx,
  sessionId: number,
  inputLines: LineInput[],
  oldItems: ItemRow[] = [],
) {
  const dishIds = [...new Set(inputLines.map((l) => l.menuItemId))];
  const dishes = new Map(
    (await tx.menuItem.findMany({ where: { id: { in: dishIds } } })).map((d) => [d.id, d]),
  );

  const priced = inputLines.map((line, index) => {
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
  for (const old of oldItems) add(old.menuItemId, dec(old.stockQuantity.toString()).negated());
  await applyStockDeltas(tx, sessionId, deltas);

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
  return { lines, linesTotal: sum(priced.map((l) => l.totalPrice)) };
}

/**
 * Creates or replaces the table's unpaid order, in one transaction with its stock (see
 * priceAndReserve). An existing order must be saved with the version the client loaded (another
 * device may have changed it), a new one with no version.
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
      } else {
        // A new order needs a table that exists and is shown. An order already on a hidden or
        // removed number can still be edited and paid (above). Checked inside the transaction,
        // so hiding a table and opening an order on it cannot interleave.
        const table = await tx.diningTable.findFirst({
          where: { number: input.tableNumber, isActive: true, hall: { isActive: true } },
        });
        if (!table) {
          throw conflict("Bunday stol yo'q yoki yashirilgan", {
            reason: 'TABLE_UNAVAILABLE',
            tableNumber: input.tableNumber,
          });
        }
      }

      const { lines, linesTotal } = await priceAndReserve(
        tx,
        sessionId,
        input.lines,
        existing?.items,
      );
      const total = toMoneyString(linesTotal);

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

/** Cancels an unpaid order (already loaded with items) and gives its stock back to the shift. */
async function cancelPending(
  tx: Tx,
  order: {
    id: number;
    version: number;
    sessionId: number;
    items: ItemRow[];
    _count: { payments: number };
  },
  expectedVersion: number | undefined,
): Promise<void> {
  if (expectedVersion !== undefined && expectedVersion !== order.version) {
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

  const res = await tx.order.updateMany({
    where: { id: order.id, version: order.version, status: 'pending' },
    data: { status: 'cancelled', version: { increment: 1 } },
  });
  if (res.count !== 1) throw staleOrder(null);
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
    await cancelPending(tx, order, input.expectedVersion);
    return order.id;
  });
  return getOrder(db, id);
}

// ── Takeaway and delivery (feature F1-B) ─────────────────────────────────────────────────────

/** Loads a pending takeaway/delivery order for a change, checking type, state and version. */
async function openOrderForChange(tx: Tx, orderId: number, expectedVersion: number | undefined) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, _count: { select: { payments: true } } },
  });
  if (!order) throw notFound('Buyurtma');
  if (order.orderType === 'DINE_IN') throw conflict('Bu stol buyurtmasi');
  // Paid or cancelled on another device since it was loaded.
  if (order.status !== 'pending') throw staleOrder(order.version);
  if (expectedVersion !== undefined && expectedVersion !== order.version)
    throw staleOrder(order.version);
  return order;
}

/**
 * Creates or replaces a takeaway or delivery order (no table: tableNumber 0), with the same
 * pricing and stock rules as a table order. The customer is found or created by phone and the
 * order keeps a copy of the details it was saved with. The delivery fee is part of the total.
 * A new order of a type switched off in settings is refused; existing ones can still be finished.
 */
export async function saveOpenOrder(
  db: Db,
  actor: Actor,
  input: SaveOpenOrderInput,
): Promise<OrderDto> {
  const id = await db.$transaction(async (tx) => {
    const sessionId = await requireOpenSessionId(tx);
    const existing =
      input.orderId === undefined
        ? null
        : await openOrderForChange(tx, input.orderId, input.expectedVersion);

    if (existing) {
      if (input.expectedVersion === undefined) throw staleOrder(existing.version);
      if (existing.sessionId !== sessionId) throw conflict('Buyurtma oldingi smenaga tegishli');
    }
    // A switched-off type takes no new orders, and no order switches into it; an open order of
    // that type can still be finished.
    const settings = await getSettings(tx);
    if (!existing || existing.orderType !== input.orderType) {
      const enabled =
        input.orderType === 'TAKEAWAY' ? settings.takeawayEnabled : settings.deliveryEnabled;
      if (!enabled)
        throw conflict("Bu buyurtma turi sozlamalarda o'chirilgan", { reason: 'TYPE_DISABLED' });
    }

    const { lines, linesTotal } = await priceAndReserve(
      tx,
      sessionId,
      input.lines,
      existing?.items,
    );
    const delivery = input.orderType === 'DELIVERY';
    // Rounded once, so the stored fee and the total always add up.
    const fee = delivery
      ? roundMoney(
          input.deliveryFee ??
            (existing?.orderType === 'DELIVERY'
              ? existing.deliveryFee.toString()
              : settings.deliveryFeeDefault),
        )
      : dec(0);
    const customerId = input.customerPhone
      ? await upsertCustomer(tx, {
          phone: input.customerPhone,
          name: input.customerName,
          address: delivery ? input.deliveryAddress : null,
          landmark: delivery ? input.deliveryNote : null,
        })
      : null;

    const data = {
      orderType: input.orderType,
      customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      deliveryAddress: delivery ? input.deliveryAddress : null,
      deliveryNote: input.deliveryNote,
      deliveryFee: fee.toFixed(),
      totalAmount: toMoneyString(linesTotal.plus(fee)),
      deliveryStatus: delivery ? (existing?.deliveryStatus ?? 'PREPARING') : null,
      courierName: delivery ? (existing?.courierName ?? null) : null,
    } as const;

    if (existing) {
      await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
      const res = await tx.order.updateMany({
        where: { id: existing.id, version: existing.version, status: 'pending' },
        data: { ...data, version: { increment: 1 } },
      });
      if (res.count !== 1) throw staleOrder(null);
      await tx.orderItem.createMany({ data: lines.map((l) => ({ ...l, orderId: existing.id })) });
      return existing.id;
    }

    const order = await tx.order.create({
      data: {
        ...data,
        orderNumber: await nextOrderNumber(tx),
        tableNumber: 0,
        sessionId,
        createdById: actor.id,
        items: { create: lines },
      },
    });
    return order.id;
  });
  return getOrder(db, id);
}

/** Unpaid takeaway and delivery orders, oldest first (the kitchen's queue order). */
export async function listOpenOrders(db: DbOrTx): Promise<OpenOrderSummaryDto[]> {
  const rows = await db.order.findMany({
    where: { status: 'pending', orderType: { in: ['TAKEAWAY', 'DELIVERY'] } },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    orderType: o.orderType as OpenOrderSummaryDto['orderType'],
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    deliveryAddress: o.deliveryAddress,
    deliveryStatus: o.deliveryStatus,
    totalAmount: decStr(o.totalAmount),
    lineCount: o._count.items,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  }));
}

export async function cancelOpenOrder(
  db: Db,
  input: z.infer<typeof orderIdInput>,
): Promise<OrderDto> {
  await db.$transaction(async (tx) => {
    const order = await openOrderForChange(tx, input.orderId, input.expectedVersion);
    await cancelPending(tx, order, input.expectedVersion);
  });
  return getOrder(db, input.orderId);
}

/** Preparing -> on the way -> delivered, with the courier's name (any user; no money moves). */
export async function setDeliveryStatus(
  db: Db,
  input: z.infer<typeof deliveryStatusInput>,
): Promise<OrderDto> {
  await db.$transaction(async (tx) => {
    const order = await openOrderForChange(tx, input.orderId, input.expectedVersion);
    if (order.orderType !== 'DELIVERY') throw conflict('Bu yetkazib berish buyurtmasi emas');
    const res = await tx.order.updateMany({
      where: { id: order.id, version: order.version, status: 'pending' },
      data: {
        deliveryStatus: input.status,
        ...(input.courierName !== undefined ? { courierName: input.courierName } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw staleOrder(null);
  });
  return getOrder(db, input.orderId);
}
