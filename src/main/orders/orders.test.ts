import {
  closeSessionInput,
  listChecksInput,
  menuItemInput,
  saveTableOrderInput,
} from '@shared/schemas';
import type { Actor } from '../domain/db';
import { dayKey } from '../domain/db';
import { createMenuItem, updateMenuItem } from '../menu/menu-items';
import { cancelPaidOrder, listChecks, payOrder, updatePayment } from '../payments/payments';
import {
  closeSession,
  deleteSession,
  getOpenSession,
  getPendingCarry,
  openSession,
  updateOpenSession,
} from '../sessions/sessions';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { cancelTableOrder, getTableOrder, listBusyTables, saveTableOrder } from './orders';

jest.setTimeout(60_000);

let t: TestDb;
let cashier: Actor;
let non: number; // plain, 5 000
let osh: number; // portions, 25 000
let shashlik: number; // by weight, 180 000 / kg
let unused: number; // not in the shift

beforeAll(async () => {
  t = await createTestDb();
  cashier = await createUser(t.db, { username: 'kassir' });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  const mk = async (over: Record<string, unknown>) =>
    (await createMenuItem(t.db, menuItemInput.parse({ categoryId, ...over }))).id;
  non = await mk({ nameUz: 'Non', price: '5000' });
  osh = await mk({ nameUz: 'Osh', price: '25000', hasPortions: true });
  shashlik = await mk({ nameUz: 'Shashlik', price: '180000', soldByWeight: true });
  unused = await mk({ nameUz: 'Somsa', price: '8000' });
});
afterAll(() => t.close());

const save = (tableNumber: number, lines: unknown[], expectedVersion?: number) =>
  saveTableOrder(t.db, cashier, saveTableOrderInput.parse({ tableNumber, lines, expectedVersion }));

async function sold(): Promise<Record<string, string>> {
  const s = await getOpenSession(t.db);
  return Object.fromEntries((s?.items ?? []).map((i) => [i.nameUz, i.soldQuantity]));
}

describe('a trading day', () => {
  it('takes no orders without an open shift', async () => {
    await expect(save(1, [{ menuItemId: non, quantity: 1 }])).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('opens one shift only', async () => {
    const s = await openSession(t.db, cashier, {
      items: [
        { menuItemId: non, initialQuantity: '50' },
        { menuItemId: osh, initialQuantity: '20' },
        { menuItemId: shashlik, initialQuantity: '5' },
      ],
    });
    expect(s).toMatchObject({ status: 'open', openedBy: 'kassir' });
    await expect(
      openSession(t.db, cashier, { items: [{ menuItemId: non, initialQuantity: '1' }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('prices on the server and takes stock: plain, portion and weight lines', async () => {
    const order = await save(1, [
      { menuItemId: non, quantity: 2 },
      { menuItemId: osh, quantity: 3, portion: '0.7' },
      { menuItemId: shashlik, quantity: 2, weightKg: '0.25' },
    ]);
    expect(order.orderNumber).toBe(`${new Date().getFullYear()}-00001`);
    expect(order.totalAmount).toBe('152500'); // 10 000 + 52 500 + 90 000
    expect(order.lines.map((l) => [l.unitPrice, l.totalPrice, l.stockQuantity])).toEqual([
      ['5000', '10000', '2'],
      ['17500', '52500', '2.1'],
      ['45000', '90000', '0.5'],
    ]);
    expect(order.version).toBe(0);
    expect(await sold()).toEqual({ Non: '2', Osh: '2.1', Shashlik: '0.5' });
  });

  it('editing gives back exactly what the old lines took (no drift, legacy quirk 1)', async () => {
    const order = await save(
      1,
      [
        { menuItemId: osh, quantity: 1, portion: '0.5' },
        { menuItemId: shashlik, quantity: 2, weightKg: '0.25' },
      ],
      0,
    );
    expect(order.version).toBe(1);
    expect(order.totalAmount).toBe('102500');
    expect(await sold()).toEqual({ Non: '0', Osh: '0.5', Shashlik: '0.5' });
  });

  it('refuses a save based on an old version and changes nothing', async () => {
    await expect(save(1, [{ menuItemId: non, quantity: 9 }], 0)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'STALE', currentVersion: 1 },
    });
    await expect(save(1, [{ menuItemId: non, quantity: 9 }])).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await sold()).toEqual({ Non: '0', Osh: '0.5', Shashlik: '0.5' });
  });

  it('a shortage lists every short dish and changes nothing (all or nothing, quirk 2)', async () => {
    const attempt = save(
      1,
      [
        { menuItemId: shashlik, quantity: 30, weightKg: '0.25' }, // 7.5 kg of 5
        { menuItemId: unused, quantity: 1 }, // not in the shift
        { menuItemId: non, quantity: 1 }, // fine on its own
      ],
      1,
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        shortages: expect.arrayContaining([
          expect.objectContaining({
            nameUz: 'Shashlik',
            reason: 'INSUFFICIENT',
            remaining: '4.5',
            requested: '7',
          }),
          expect.objectContaining({ nameUz: 'Somsa', reason: 'NOT_IN_SESSION' }),
        ]),
      },
    });
    expect((await getTableOrder(t.db, 1))?.version).toBe(1);
    expect(await sold()).toEqual({ Non: '0', Osh: '0.5', Shashlik: '0.5' });
  });

  it('rejects bad lines with the line index', async () => {
    await expect(
      save(2, [
        { menuItemId: non, quantity: 1 },
        { menuItemId: shashlik, quantity: 1 },
      ]),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { lineIndex: 1, field: 'weightKg' },
    });
  });

  it('cancel gives the stock back, frees the table and keeps the order as cancelled', async () => {
    const cancelled = await cancelTableOrder(t.db, { tableNumber: 1, expectedVersion: 1 });
    expect(cancelled.status).toBe('cancelled');
    expect(await getTableOrder(t.db, 1)).toBeNull();
    expect(await sold()).toEqual({ Non: '0', Osh: '0', Shashlik: '0' });
  });

  it('pays in full: cash is paid, debt stays pending; a paid order cannot be paid again', async () => {
    const a = await save(1, [{ menuItemId: non, quantity: 3 }]);
    const b = await save(2, [{ menuItemId: osh, quantity: 2 }]);
    expect((await listBusyTables(t.db)).map((x) => x.tableNumber)).toEqual([1, 2]);

    const paidA = await payOrder(t.db, cashier, {
      orderId: a.id,
      method: 'cash',
      expectedVersion: a.version,
    });
    expect(paidA).toMatchObject({ status: 'completed', paymentMethod: 'cash' });
    expect(paidA.payments).toEqual([
      expect.objectContaining({ amount: '15000', method: 'cash', status: 'paid' }),
    ]);
    await expect(payOrder(t.db, cashier, { orderId: a.id, method: 'card' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const paidB = await payOrder(t.db, cashier, { orderId: b.id, method: 'debt' });
    expect(paidB.payments[0]).toMatchObject({ amount: '50000', status: 'pending' });
    expect(await listBusyTables(t.db)).toEqual([]);
    expect(await sold()).toEqual({ Non: '3', Osh: '2', Shashlik: '0' });
  });

  it('checks list filters by day and method; admin can correct a check', async () => {
    const today = dayKey(new Date());
    const all = await listChecks(t.db, listChecksInput.parse({ startDate: today, endDate: today }));
    expect(all.map((c) => c.amount).sort()).toEqual(['15000', '50000']);
    const debt = await listChecks(
      t.db,
      listChecksInput.parse({ startDate: today, endDate: today, method: 'debt' }),
    );
    expect(debt).toHaveLength(1);

    const [{ orderNumber }] = debt as [(typeof debt)[0]];
    const fixed = await updatePayment(t.db, { orderNumber, status: 'paid', method: 'card' });
    expect(fixed[0]).toMatchObject({ status: 'paid', method: 'card' });
  });

  it('deleting a check cancels its order and returns the stock to the open shift', async () => {
    const today = dayKey(new Date());
    const card = await listChecks(
      t.db,
      listChecksInput.parse({ startDate: today, endDate: today, method: 'card' }),
    );
    const { orderNumber } = card[0]!;
    expect(await sold()).toEqual({ Non: '3', Osh: '2', Shashlik: '0' });

    const cancelled = await cancelPaidOrder(t.db, orderNumber);
    expect(cancelled).toMatchObject({ status: 'cancelled', payments: [] });
    expect(await sold()).toEqual({ Non: '3', Osh: '0', Shashlik: '0' });
    expect(
      await listChecks(t.db, listChecksInput.parse({ startDate: today, endDate: today })),
    ).toHaveLength(1);

    await expect(cancelPaidOrder(t.db, orderNumber)).rejects.toMatchObject({ code: 'CONFLICT' });
    const unpaid = await save(5, [{ menuItemId: non, quantity: 1 }]);
    await expect(cancelPaidOrder(t.db, unpaid.orderNumber)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await cancelTableOrder(t.db, { tableNumber: 5, expectedVersion: unpaid.version });
  });

  it('shift edits cannot go below what is sold', async () => {
    const s = (await getOpenSession(t.db))!;
    await expect(
      updateOpenSession(t.db, {
        sessionId: s.id,
        items: [{ menuItemId: non, initialQuantity: '2' }],
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { violations: [expect.objectContaining({ soldQuantity: '3' })] },
    });
    const updated = await updateOpenSession(t.db, {
      sessionId: s.id,
      items: [
        { menuItemId: non, initialQuantity: '40' },
        { menuItemId: unused, initialQuantity: '12' },
      ],
    });
    expect(updated.items.find((i) => i.nameUz === 'Non')).toMatchObject({
      initialQuantity: '40',
      remainingQuantity: '37',
    });
    expect(updated.items).toHaveLength(4);
  });

  it('closing: refused with unpaid orders; then leftovers carry or are written off', async () => {
    const s = (await getOpenSession(t.db))!;
    const pending = await save(3, [{ menuItemId: unused, quantity: 1 }]);
    await expect(
      closeSession(t.db, cashier, closeSessionInput.parse({ sessionId: s.id })),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await cancelTableOrder(t.db, { tableNumber: 3, expectedVersion: pending.version });

    // Over-assigning is refused.
    await expect(
      closeSession(
        t.db,
        cashier,
        closeSessionInput.parse({
          sessionId: s.id,
          actions: [{ menuItemId: non, carryQuantity: '30', writeOffQuantity: '10' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Non has a cost price (2 000) -> its write-off is costed at it; Osh has none -> sale price.
    await updateMenuItem(t.db, { id: non, costPrice: '2000' });

    // Non: 37 left -> write off 7, the rest (30) carries even though only 20 was asked.
    // Osh: 20 left -> all written off. Shashlik 5, Somsa 12: no instruction -> carried.
    const result = await closeSession(
      t.db,
      cashier,
      closeSessionInput.parse({
        sessionId: s.id,
        actions: [
          { menuItemId: non, carryQuantity: '20', writeOffQuantity: '7', note: 'qotib qoldi' },
          { menuItemId: osh, writeOffQuantity: '20' },
        ],
      }),
    );
    expect(result.carried).toEqual(
      expect.arrayContaining([
        { menuItemId: non, quantity: '30' },
        { menuItemId: shashlik, quantity: '5' },
        { menuItemId: unused, quantity: '12' },
      ]),
    );
    expect(result.writtenOff).toEqual(
      expect.arrayContaining([
        { menuItemId: non, quantity: '7', amount: '14000' },
        { menuItemId: osh, quantity: '20', amount: '500000' },
      ]),
    );
    expect(await getOpenSession(t.db)).toBeNull();

    const expense = await t.db.expense.findFirstOrThrow({
      where: { menuItemId: non },
      include: { residual: true },
    });
    expect(expense).toMatchObject({ type: 'residual_writeoff', note: 'qotib qoldi' });
    expect(expense.residual).toMatchObject({ action: 'WRITE_OFF', status: 'applied' });
  });

  it('the next shift sees exact carried quantities and takes them on opening', async () => {
    const carry = await getPendingCarry(t.db);
    expect(carry.map((c) => [c.nameUz, c.quantity]).sort()).toEqual([
      ['Non', '30'],
      ['Shashlik', '5'],
      ['Somsa', '12'],
    ]);
    const next = await openSession(t.db, cashier, {
      items: [{ menuItemId: non, initialQuantity: '30' }],
    });
    expect(await getPendingCarry(t.db)).toEqual([]);
    expect(await t.db.residual.count({ where: { appliedToSessionId: next.id } })).toBe(3);
  });

  it('only an unused shift can be deleted', async () => {
    const first = (await t.db.session.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
    await expect(deleteSession(t.db, first)).rejects.toMatchObject({ code: 'CONFLICT' });
    const open = (await getOpenSession(t.db))!;
    // It has applied residuals, so it is in use too.
    await expect(deleteSession(t.db, open.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('two devices, same table', () => {
  it('only one new order is created; the other gets a CONFLICT', async () => {
    const results = await Promise.allSettled([
      save(9, [{ menuItemId: non, quantity: 1 }]),
      save(9, [{ menuItemId: non, quantity: 2 }]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT' },
    });
  });
});
