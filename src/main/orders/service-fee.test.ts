import {
  editCheckInput,
  localDate,
  menuItemInput,
  moveTableInput,
  salesReportInput,
  saveOpenOrderInput,
  saveTableOrderInput,
} from '@shared/schemas';
import { dec } from '@shared/utils/decimal';
import type { Actor } from '../domain/db';
import { createMenuItem } from '../menu/menu-items';
import { editCheck, payOrder } from '../payments/payments';
import { salesReport, staffReport } from '../reports/reports';
import { getCashSummary } from '../sessions/cash';
import { openSession } from '../sessions/sessions';
import { updateSettings } from '../settings/settings';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { updateUser } from '../users/users';
import { moveTableOrder, saveOpenOrder, saveTableOrder } from './orders';

/**
 * Feature F17: the service fee is part of a table order's total, worked out by main on every
 * save; the opener's earnings percent is copied onto the order when it is paid; the staff
 * report sums dishes (no fees) and earnings at those percents.
 */

jest.setTimeout(60_000);

let t: TestDb;
let waiter: Actor;
let other: Actor;
let non: number; // 5 000
let osh: number; // 25 000
let sessionId: number;

beforeAll(async () => {
  t = await createTestDb();
  waiter = await createUser(t.db, { username: 'Aziz' });
  other = await createUser(t.db, { username: 'Dilnoza' });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  const mk = async (over: Record<string, unknown>) =>
    (await createMenuItem(t.db, menuItemInput.parse({ categoryId, ...over }))).id;
  non = await mk({ nameUz: 'Non', price: '5000' });
  osh = await mk({ nameUz: 'Osh', price: '25000' });
  sessionId = (
    await openSession(t.db, waiter, {
      items: [
        { menuItemId: non, initialQuantity: '100' },
        { menuItemId: osh, initialQuantity: '100' },
      ],
    })
  ).id;
});
afterAll(() => t.close());

const save = (
  by: Actor,
  tableNumber: number,
  lines: unknown[],
  extra: { expectedVersion?: number; guestCount?: number } = {},
) => saveTableOrder(t.db, by, saveTableOrderInput.parse({ tableNumber, lines, ...extra }));

describe('service fee (F17)', () => {
  it('off by default: the total is the dishes', async () => {
    const o = await save(waiter, 1, [{ menuItemId: non, quantity: 2 }]);
    expect(o).toMatchObject({ serviceFee: '0', totalAmount: '10000', guestCount: null });
  });

  it('percent: on every save, from the settings of that moment', async () => {
    await updateSettings(t.db, { serviceFeeType: 'percent', serviceFeePercent: '10' });
    const o = await save(waiter, 2, [{ menuItemId: osh, quantity: 1 }]);
    expect(o).toMatchObject({ serviceFee: '2500', totalAmount: '27500' });

    // A saved order keeps its fee until it is saved again.
    await updateSettings(t.db, { serviceFeePercent: '15' });
    const again = await save(waiter, 2, [{ menuItemId: osh, quantity: 2 }], {
      expectedVersion: o.version,
    });
    expect(again).toMatchObject({ serviceFee: '7500', totalAmount: '57500' });
  });

  it('per guest: the count is kept between saves; no count = one guest', async () => {
    await updateSettings(t.db, { serviceFeeType: 'perGuest', serviceFeePerGuest: '3000' });
    const o = await save(waiter, 3, [{ menuItemId: non, quantity: 1 }], { guestCount: 4 });
    expect(o).toMatchObject({ serviceFee: '12000', totalAmount: '17000', guestCount: 4 });
    const again = await save(waiter, 3, [{ menuItemId: non, quantity: 2 }], {
      expectedVersion: o.version,
    });
    expect(again).toMatchObject({ serviceFee: '12000', totalAmount: '22000', guestCount: 4 });

    const single = await save(other, 4, [{ menuItemId: non, quantity: 1 }]);
    expect(single).toMatchObject({ serviceFee: '3000', totalAmount: '8000' });
  });

  it('takeaway and delivery carry no service fee', async () => {
    const o = await saveOpenOrder(
      t.db,
      waiter,
      saveOpenOrderInput.parse({
        orderType: 'TAKEAWAY',
        lines: [{ menuItemId: non, quantity: 1 }],
      }),
    );
    expect(o).toMatchObject({ serviceFee: '0', totalAmount: '5000' });
  });

  it('paid: the fee is paid with the rest, the percent is fixed, the report sums dishes', async () => {
    await updateUser(t.db, other, { id: waiter.id, earningsPercent: '5' });
    await updateUser(t.db, waiter, { id: other.id, earningsPercent: '10' });
    const table2 = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 2 } });
    const paid = await payOrder(t.db, waiter, { orderId: table2.id, method: 'cash' });
    expect(paid.payments).toEqual([expect.objectContaining({ amount: '57500' })]);
    expect(
      (await t.db.order.findUniqueOrThrow({ where: { id: table2.id } })).waiterPercent?.toString(),
    ).toBe('5');

    // Changing the rate afterwards does not rewrite what was earned.
    await updateUser(t.db, other, { id: waiter.id, earningsPercent: '50' });
    const table3 = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 3 } });
    await payOrder(t.db, waiter, { orderId: table3.id, method: 'card' });
    const table4 = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 4 } });
    await payOrder(t.db, other, { orderId: table4.id, method: 'cash' });

    const report = await staffReport(t.db, { start: localDate(), end: localDate() });
    // Aziz: table 2 (50 000 dishes at 5 % = 2 500) + table 3 (10 000 at 50 % = 5 000).
    expect(report.rows).toEqual([
      {
        userId: waiter.id,
        fullName: 'Aziz',
        orders: 2,
        guests: 4,
        sales: '60000',
        serviceFees: '19500',
        currentPercent: '50',
        earnings: '7500',
      },
      {
        userId: other.id,
        fullName: 'Dilnoza',
        orders: 1,
        guests: 0,
        sales: '5000',
        serviceFees: '3000',
        currentPercent: '10',
        earnings: '500',
      },
    ]);
    expect(report.totals).toEqual({
      orders: 3,
      guests: 4,
      sales: '65000',
      serviceFees: '22500',
      earnings: '8000',
    });

    // The shift summary says how much of the sales was service fee.
    expect((await getCashSummary(t.db, sessionId)).serviceFees).toBe('22500');
  });

  it('moved, split-paid and corrected: the fee moves with the order and counts once', async () => {
    await updateSettings(t.db, { serviceFeeType: 'percent', serviceFeePercent: '10' });
    const o = await save(waiter, 5, [{ menuItemId: osh, quantity: 2 }]); // 50 000 + 5 000
    const moved = await moveTableOrder(
      t.db,
      moveTableInput.parse({ fromTable: 5, toTable: 6, expectedVersion: o.version }),
      { actor: waiter },
    );
    expect(moved).toMatchObject({ serviceFee: '5000', totalAmount: '55000', tableNumber: 6 });

    const before = await getCashSummary(t.db, sessionId);
    const paid = await payOrder(t.db, waiter, {
      orderId: moved.id,
      tenders: [
        { method: 'cash', amount: '30000' },
        { method: 'card', amount: '25000' },
      ],
    });
    const after = await getCashSummary(t.db, sessionId);
    expect(dec(after.serviceFees).minus(before.serviceFees).toFixed()).toBe('5000');
    expect(after.checksCount - before.checksCount).toBe(1);
    const sales = await salesReport(
      t.db,
      salesReportInput.parse({ start: localDate(), end: localDate() }),
    );
    expect(sales.daily[0]!.serviceFees).toBe(after.serviceFees);

    // A check correction re-splits the same total (fee included) and keeps the waiter's percent.
    await expect(
      editCheck(
        t.db,
        other,
        editCheckInput.parse({
          orderNumber: paid.orderNumber,
          tenders: [{ method: 'card', amount: '50000' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await editCheck(
      t.db,
      other,
      editCheckInput.parse({
        orderNumber: paid.orderNumber,
        tenders: [{ method: 'card', amount: '55000' }],
      }),
    );
    expect(
      (await t.db.order.findUniqueOrThrow({ where: { id: paid.id } })).waiterPercent?.toString(),
    ).toBe('50');

    // The report holds an order on the day of its first payment, and only that day.
    const y = localDate(-1);
    expect((await staffReport(t.db, { start: y, end: y })).rows).toEqual([]);
  });
});
