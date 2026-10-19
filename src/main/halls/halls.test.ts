import {
  diningTableInput,
  menuItemInput,
  saveTableOrderInput,
  tableRangeInput,
  updateDiningTableInput,
} from '@shared/schemas';
import { seedDatabase } from '../database/seed';
import type { Actor } from '../domain/db';
import { createMenuItem } from '../menu/menu-items';
import { cancelTableOrder, saveTableOrder } from '../orders/orders';
import { openSession } from '../sessions/sessions';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import {
  createHall,
  createTable,
  createTableRange,
  deleteHall,
  deleteTable,
  DEFAULT_HALL_NAME,
  ensureTablesForOrders,
  HALLS_SEEDED_KEY,
  listHalls,
  reorderHalls,
  updateHall,
  updateTable,
} from './halls';

jest.setTimeout(60_000);

let t: TestDb;
let cashier: Actor;
let dish: number;

beforeAll(async () => {
  t = await createTestDb();
  cashier = await createUser(t.db, { username: 'kassir' });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  dish = (
    await createMenuItem(t.db, menuItemInput.parse({ categoryId, nameUz: 'Non', price: '5000' }))
  ).id;
  await openSession(t.db, cashier, { items: [{ menuItemId: dish, initialQuantity: '100' }] });
});
afterAll(() => t.close());

const tableId = async (number: number) =>
  (await t.db.diningTable.findUniqueOrThrow({ where: { number } })).id;
const order = (tableNumber: number) =>
  saveTableOrder(
    t.db,
    cashier,
    saveTableOrderInput.parse({ tableNumber, lines: [{ menuItemId: dish, quantity: 1 }] }),
  );

describe('first hall', () => {
  it('a fresh database gets "Asosiy zal" with tables 1..10, once', async () => {
    const halls = await listHalls(t.db);
    expect(halls).toHaveLength(1);
    expect(halls[0]!.name).toBe(DEFAULT_HALL_NAME);
    expect(halls[0]!.tables.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Seed runs on every start: it must not bring the hall back after the owner changed things.
    await t.db.diningTable.deleteMany({ where: { number: 10 } });
    await seedDatabase(t.db, { freshDatabase: false });
    expect((await listHalls(t.db))[0]!.tables).toHaveLength(9);
    await t.db.diningTable.create({ data: { number: 10, hallId: halls[0]!.id } });
  });

  it('an upgraded install gets every table number its orders used', async () => {
    const other = await createTestDb();
    try {
      // As before migration 6: no halls, no tables, no seed flag.
      await other.db.diningTable.deleteMany({});
      await other.db.hall.deleteMany({});
      await other.db.setting.delete({ where: { key: HALLS_SEEDED_KEY } });
      await other.db.setting.update({ where: { key: 'table_count' }, data: { value: '4' } });
      const session = await other.db.session.create({
        data: { status: 'closed', openGuard: null },
      });
      await other.db.order.create({
        data: {
          orderNumber: '2026-00001',
          tableNumber: 7,
          sessionId: session.id,
          status: 'completed',
        },
      });

      await seedDatabase(other.db, { freshDatabase: false });
      const halls = await listHalls(other.db);
      expect(halls[0]!.tables.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    } finally {
      await other.close();
    }
  });
});

describe('halls', () => {
  it('creates halls in order with unique names', async () => {
    const terrace = await createHall(t.db, { name: 'Terrasa' });
    expect(terrace.sortOrder).toBe(1);
    await expect(createHall(t.db, { name: 'Terrasa' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('hides a hall only when it has no active tables, deletes only one without tables', async () => {
    const terrace = (await listHalls(t.db)).find((h) => h.name === 'Terrasa')!;
    await createTableRange(t.db, tableRangeInput.parse({ hallId: terrace.id, from: 11, to: 12 }));
    await expect(updateHall(t.db, { id: terrace.id, isActive: false })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(deleteHall(t.db, terrace.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const empty = await createHall(t.db, { name: 'Bo`sh' });
    await deleteHall(t.db, empty.id);
    expect((await listHalls(t.db, { includeInactive: true })).map((h) => h.name)).not.toContain(
      'Bo`sh',
    );
  });
});

describe('tables', () => {
  it('numbers are unique across halls, hidden tables included', async () => {
    const terrace = (await listHalls(t.db)).find((h) => h.name === 'Terrasa')!;
    await expect(
      createTable(t.db, diningTableInput.parse({ hallId: terrace.id, number: 3 })),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { numbers: [3] } });
    await expect(
      createTableRange(t.db, tableRangeInput.parse({ hallId: terrace.id, from: 12, to: 14 })),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { numbers: [12] } });
    // Nothing of a refused range is created.
    expect(await t.db.diningTable.count({ where: { number: { in: [13, 14] } } })).toBe(0);

    const vip = await createTable(
      t.db,
      diningTableInput.parse({ hallId: terrace.id, number: 20, label: 'VIP', seats: 6 }),
    );
    expect(vip).toMatchObject({ number: 20, label: 'VIP', seats: 6, isActive: true });
  });

  it('a range is refused beyond 100 tables or backwards', () => {
    expect(tableRangeInput.safeParse({ hallId: 1, from: 5, to: 4 }).success).toBe(false);
    expect(tableRangeInput.safeParse({ hallId: 1, from: 1, to: 100 }).success).toBe(true);
    expect(tableRangeInput.safeParse({ hallId: 1, from: 1, to: 101 }).success).toBe(false);
  });

  it('a table with an unpaid order cannot be renumbered or hidden, but can be relabelled', async () => {
    const id = await tableId(2);
    const o = await order(2);
    await expect(
      updateTable(t.db, updateDiningTableInput.parse({ id, number: 30 })),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'PENDING_ORDER' } });
    await expect(
      updateTable(t.db, updateDiningTableInput.parse({ id, isActive: false })),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'PENDING_ORDER' } });
    expect(
      await updateTable(t.db, updateDiningTableInput.parse({ id, label: 'Deraza' })),
    ).toMatchObject({ number: 2, label: 'Deraza' });

    await cancelTableOrder(t.db, { tableNumber: 2, expectedVersion: o.version });
    expect(await updateTable(t.db, updateDiningTableInput.parse({ id, number: 30 }))).toMatchObject(
      { number: 30 },
    );
  });

  it('moves a table to another hall, never into a hidden one', async () => {
    const halls = await listHalls(t.db);
    const main = halls.find((h) => h.name === DEFAULT_HALL_NAME)!;
    const hidden = await createHall(t.db, { name: 'Yopiq' });
    await updateHall(t.db, { id: hidden.id, isActive: false });

    const id = await tableId(4);
    await expect(
      updateTable(t.db, updateDiningTableInput.parse({ id, hallId: hidden.id })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const terrace = halls.find((h) => h.name === 'Terrasa')!;
    expect(
      await updateTable(t.db, updateDiningTableInput.parse({ id, hallId: terrace.id })),
    ).toMatchObject({ hallId: terrace.id });
    await updateTable(t.db, updateDiningTableInput.parse({ id, hallId: main.id }));
  });

  it('deletes only a table no order used; hidden tables leave the normal list', async () => {
    // Renumbering moved no history: table 30 (was 2) has no orders, the old number 2 keeps them.
    expect(await t.db.order.count({ where: { tableNumber: 2 } })).toBe(1);
    expect(await t.db.order.count({ where: { tableNumber: 30 } })).toBe(0);

    const o = await order(3);
    await cancelTableOrder(t.db, { tableNumber: 3, expectedVersion: o.version });
    const used = await tableId(3);
    await expect(deleteTable(t.db, used)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'HAS_ORDERS' },
    });
    await updateTable(t.db, updateDiningTableInput.parse({ id: used, isActive: false }));
    const visible = (await listHalls(t.db)).flatMap((h) => h.tables.map((x) => x.number));
    expect(visible).not.toContain(3);
    const all = (await listHalls(t.db, { includeInactive: true })).flatMap((h) =>
      h.tables.map((x) => x.number),
    );
    expect(all).toContain(3);

    await deleteTable(t.db, await tableId(20));
    expect(await t.db.diningTable.count({ where: { number: 20 } })).toBe(0);
  });
});

describe('orders and tables', () => {
  it('a new order needs an active table in an active hall', async () => {
    const halls = await listHalls(t.db);
    const terrace = halls.find((h) => h.name === 'Terrasa')!;
    // No such table at all.
    await expect(order(77)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'TABLE_UNAVAILABLE', tableNumber: 77 },
    });
    // Hidden table (3, hidden by the test above).
    await expect(order(3)).rejects.toMatchObject({ details: { reason: 'TABLE_UNAVAILABLE' } });
    // Active table in a hidden hall: hide table 12 first so the hall can be hidden, keep 11.
    const solo = await createHall(t.db, { name: 'Yozgi' });
    await createTable(t.db, diningTableInput.parse({ hallId: solo.id, number: 40 }));
    expect((await order(40)).tableNumber).toBe(40);
    await t.db.hall.update({ where: { id: solo.id }, data: { isActive: false } });
    await expect(order(41)).rejects.toMatchObject({ details: { reason: 'TABLE_UNAVAILABLE' } });
    expect(terrace.isActive).toBe(true);
  });

  it('an unpaid order already on a now-hidden table can still be edited', async () => {
    // Table 40 is in the hall hidden just above, with an unpaid order on it.
    const current = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 40 } });
    const saved = await saveTableOrder(
      t.db,
      cashier,
      saveTableOrderInput.parse({
        tableNumber: 40,
        expectedVersion: current.version,
        lines: [{ menuItemId: dish, quantity: 2 }],
      }),
    );
    expect(saved.totalAmount).toBe('10000');
    await cancelTableOrder(t.db, { tableNumber: 40, expectedVersion: saved.version });
  });
});

describe('reorder and repair', () => {
  it('reorders every hall at once and refuses a list that is out of date', async () => {
    const before = await listHalls(t.db, { includeInactive: true });
    const ids = before.map((h) => h.id).reverse();
    const after = await reorderHalls(t.db, ids);
    expect(after.map((h) => h.id)).toEqual(ids);
    await expect(reorderHalls(t.db, ids.slice(1))).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'STALE' },
    });
    await expect(reorderHalls(t.db, [ids[0]!, ...ids.slice(0, -1)])).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('adds a table for every number an order uses that has none (after a legacy import)', async () => {
    const session = await t.db.session.findFirstOrThrow({ where: { status: 'open' } });
    await t.db.order.create({
      data: {
        orderNumber: '2020-00099',
        tableNumber: 55,
        sessionId: session.id,
        status: 'completed',
      },
    });
    // 55, and 2: table 2 was renumbered to 30 above, its orders keep number 2.
    expect(await t.db.$transaction((tx) => ensureTablesForOrders(tx))).toBe(2);
    expect(await t.db.diningTable.count({ where: { number: { in: [2, 55] } } })).toBe(2);
    expect(await t.db.$transaction((tx) => ensureTablesForOrders(tx))).toBe(0);
  });
});
