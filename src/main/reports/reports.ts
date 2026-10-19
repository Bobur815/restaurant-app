import type { z } from 'zod';
import type { salesReportInput } from '@shared/schemas';
import type { DailyReportRow, ProductSalesRow, SalesReport } from '@shared/types';
import { dec, toMoneyString, toQtyString, type Dec } from '@shared/utils/decimal';
import { dayEnd, dayKey, dayStart, type Db } from '../domain/db';

/**
 * Sales report for a local-date range (legacy hisobotlar): per day, payments by method and
 * expenses by type; and dishes sold per day. Rows are selected by range in SQL and summed here
 * with exact decimals (SQLite would sum DECIMAL columns as floating point).
 *
 * Legacy parity: a day is the payment's local date; every payment counts (debt included, as
 * `debt`); "products sold" is per payment day. Added: `stockQuantity` (portions and kg applied,
 * legacy counted a half portion as 1, quirk 7) and `revenue` per dish.
 */
export async function salesReport(
  db: Db,
  input: z.infer<typeof salesReportInput>,
): Promise<SalesReport> {
  const range = { gte: dayStart(input.start), lte: dayEnd(input.end) };

  const [payments, expenses] = await Promise.all([
    db.payment.findMany({
      where: { paidAt: range },
      select: {
        amount: true,
        method: true,
        paidAt: true,
        order: {
          select: {
            id: true,
            orderType: true,
            deliveryFee: true,
            items: {
              select: {
                menuItemId: true,
                quantity: true,
                stockQuantity: true,
                totalPrice: true,
                menuItem: { select: { nameUz: true } },
              },
            },
          },
        },
      },
    }),
    db.expense.findMany({
      where: { createdAt: range },
      select: { type: true, amount: true, quantity: true, createdAt: true },
    }),
  ]);

  type Acc = Record<
    | 'total'
    | 'cash'
    | 'card'
    | 'click'
    | 'debt'
    | 'DINE_IN'
    | 'TAKEAWAY'
    | 'DELIVERY'
    | 'fees'
    | 'expense'
    | 'writeoff'
    | 'waste'
    | 'breakage'
    | 'expenseQty',
    Dec
  > & {
    orders: number;
  };
  const zero = () => dec(0);
  const days = new Map<string, Acc>();
  const day = (key: string): Acc => {
    let acc = days.get(key);
    if (!acc) {
      acc = {
        orders: 0,
        total: zero(),
        cash: zero(),
        card: zero(),
        click: zero(),
        debt: zero(),
        DINE_IN: zero(),
        TAKEAWAY: zero(),
        DELIVERY: zero(),
        fees: zero(),
        expense: zero(),
        writeoff: zero(),
        waste: zero(),
        breakage: zero(),
        expenseQty: zero(),
      };
      days.set(key, acc);
    }
    return acc;
  };

  const products = new Map<
    string,
    Map<number, { nameUz: string; quantity: Dec; stock: Dec; revenue: Dec }>
  >();

  const feeCounted = new Set<number>();
  for (const p of payments) {
    const key = dayKey(p.paidAt);
    const acc = day(key);
    const amount = dec(p.amount.toString());
    acc.orders += 1;
    acc.total = acc.total.plus(amount);
    acc[p.method] = acc[p.method].plus(amount);
    acc[p.order.orderType] = acc[p.order.orderType].plus(amount);
    // A fee belongs to the order, not to each of its payments.
    if (!feeCounted.has(p.order.id)) {
      feeCounted.add(p.order.id);
      acc.fees = acc.fees.plus(p.order.deliveryFee.toString());
    }

    const perDay = products.get(key) ?? new Map();
    products.set(key, perDay);
    for (const line of p.order.items) {
      const row = perDay.get(line.menuItemId) ?? {
        nameUz: line.menuItem.nameUz,
        quantity: zero(),
        stock: zero(),
        revenue: zero(),
      };
      row.quantity = row.quantity.plus(line.quantity.toString());
      row.stock = row.stock.plus(line.stockQuantity.toString());
      row.revenue = row.revenue.plus(line.totalPrice.toString());
      perDay.set(line.menuItemId, row);
    }
  }

  for (const e of expenses) {
    const acc = day(dayKey(e.createdAt));
    const amount = dec(e.amount.toString());
    acc.expense = acc.expense.plus(amount);
    acc.expenseQty = acc.expenseQty.plus(e.quantity.toString());
    if (e.type === 'residual_writeoff') acc.writeoff = acc.writeoff.plus(amount);
    else if (e.type === 'waste') acc.waste = acc.waste.plus(amount);
    else acc.breakage = acc.breakage.plus(amount);
  }

  const daily: DailyReportRow[] = [...days.entries()].map(([date, a]) => ({
    date,
    numberOfOrders: a.orders,
    total: toMoneyString(a.total),
    cash: toMoneyString(a.cash),
    card: toMoneyString(a.card),
    click: toMoneyString(a.click),
    debt: toMoneyString(a.debt),
    plastic: toMoneyString(a.card.plus(a.click)),
    dineIn: toMoneyString(a.DINE_IN),
    takeaway: toMoneyString(a.TAKEAWAY),
    delivery: toMoneyString(a.DELIVERY),
    deliveryFees: toMoneyString(a.fees),
    expenseTotal: toMoneyString(a.expense),
    residualWriteOff: toMoneyString(a.writeoff),
    waste: toMoneyString(a.waste),
    breakage: toMoneyString(a.breakage),
    expenseQuantity: toQtyString(a.expenseQty),
  }));

  const sign = input.direction === 'desc' ? -1 : 1;
  daily.sort((x, y) => {
    const primary =
      input.sortBy === 'total'
        ? dec(x.total).comparedTo(dec(y.total))
        : x.date.localeCompare(y.date);
    return sign * primary || x.date.localeCompare(y.date);
  });

  const productsByDate = [...products.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, perDay]) => ({
      date,
      products: [...perDay.entries()]
        .map(
          ([menuItemId, r]): ProductSalesRow => ({
            menuItemId,
            nameUz: r.nameUz,
            quantity: toQtyString(r.quantity),
            stockQuantity: toQtyString(r.stock),
            revenue: toMoneyString(r.revenue),
          }),
        )
        .sort((a, b) => a.nameUz.localeCompare(b.nameUz)),
    }));

  return { daily, productsByDate };
}
