import {
  closeSessionInput,
  listExpensesInput,
  listResidualsInput,
  menuItemInput,
  saveTableOrderInput,
  salesReportInput,
} from '@shared/schemas';
import { dayKey, type Actor } from '../domain/db';
import { createMenuItem } from '../menu/menu-items';
import { saveTableOrder } from '../orders/orders';
import { payOrder } from '../payments/payments';
import { listExpenses, listResiduals, applyResiduals } from '../residuals/residuals';
import { closeSession, openSession } from '../sessions/sessions';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { salesReport } from './reports';

jest.setTimeout(60_000);

let t: TestDb;
let actor: Actor;
let osh: number;
let choy: number;
const today = dayKey(new Date());

beforeAll(async () => {
  t = await createTestDb();
  actor = await createUser(t.db, { username: 'admin', role: 'ADMIN' });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  osh = (
    await createMenuItem(
      t.db,
      menuItemInput.parse({ nameUz: 'Osh', price: '25000', hasPortions: true, categoryId }),
    )
  ).id;
  choy = (
    await createMenuItem(t.db, menuItemInput.parse({ nameUz: 'Choy', price: '3000', categoryId }))
  ).id;

  const s = await openSession(t.db, actor, {
    items: [
      { menuItemId: osh, initialQuantity: '10' },
      { menuItemId: choy, initialQuantity: '20' },
    ],
  });
  const pay = async (
    table: number,
    lines: unknown[],
    method: 'cash' | 'card' | 'click' | 'debt',
  ) => {
    const o = await saveTableOrder(
      t.db,
      actor,
      saveTableOrderInput.parse({ tableNumber: table, lines }),
    );
    await payOrder(t.db, actor, {
      orderId: o.id,
      method,
      ...(method === 'debt'
        ? { debtCustomer: { phone: '998901112233', name: 'Ali', dueDate: null } }
        : {}),
    });
  };
  await pay(
    1,
    [
      { menuItemId: osh, quantity: 2, portion: '0.5' },
      { menuItemId: choy, quantity: 2 },
    ],
    'cash',
  ); // 25 000 + 6 000
  await pay(2, [{ menuItemId: osh, quantity: 1 }], 'card'); // 25 000
  await pay(3, [{ menuItemId: choy, quantity: 1 }], 'click'); // 3 000
  await pay(4, [{ menuItemId: osh, quantity: 1, portion: '0.7' }], 'debt'); // 17 500
  await closeSession(
    t.db,
    actor,
    closeSessionInput.parse({
      sessionId: s.id,
      actions: [{ menuItemId: osh, writeOffQuantity: '1', note: 'Kuyib qoldi' }],
    }),
  );
});
afterAll(() => t.close());

describe('sales report', () => {
  it('sums the day by payment method, with exact decimals', async () => {
    const report = await salesReport(t.db, salesReportInput.parse({ start: today, end: today }));
    expect(report.daily).toEqual([
      {
        date: today,
        numberOfOrders: 4,
        total: '76500',
        cash: '31000',
        card: '25000',
        click: '3000',
        debt: '17500',
        plastic: '28000',
        dineIn: '76500',
        takeaway: '0',
        delivery: '0',
        deliveryFees: '0',
        repayments: '0',
        repaymentCash: '0',
        repaymentCard: '0',
        repaymentClick: '0',
        writtenOff: '0',
        received: '59000',
        expenseTotal: '25000',
        residualWriteOff: '25000',
        waste: '0',
        breakage: '0',
        expenseQuantity: '1',
      },
    ]);
  });

  it('reports dishes by units (legacy) and by stock actually used', async () => {
    const report = await salesReport(t.db, salesReportInput.parse({ start: today, end: today }));
    expect(report.productsByDate).toEqual([
      {
        date: today,
        products: [
          { menuItemId: choy, nameUz: 'Choy', quantity: '3', stockQuantity: '3', revenue: '9000' },
          { menuItemId: osh, nameUz: 'Osh', quantity: '4', stockQuantity: '2.7', revenue: '67500' },
        ],
      },
    ]);
  });

  it('a range with no sales is empty', async () => {
    expect(
      await salesReport(t.db, salesReportInput.parse({ start: '2001-01-01', end: '2001-01-31' })),
    ).toEqual({
      daily: [],
      productsByDate: [],
    });
  });
});

describe('residuals and expenses lists', () => {
  it('note search is case-insensitive and works on SQLite (legacy quirk 6)', async () => {
    const found = await listExpenses(t.db, listExpensesInput.parse({ q: 'KUYIB' }));
    expect(found.items).toHaveLength(1);
    expect(found.totals).toEqual({
      totalAmount: '25000',
      byType: { residual_writeoff: { count: 1, amount: '25000', quantity: '1' } },
    });
    // The close note is kept on both of the dish's leftover rows (carried and written off).
    const residuals = await listResiduals(t.db, listResidualsInput.parse({ q: 'kuyib' }));
    expect(residuals.items.map((r) => r.action).sort()).toEqual(['CARRY_TO_NEXT', 'WRITE_OFF']);
  });

  it('lists leftovers with totals by action and pages', async () => {
    const all = await listResiduals(t.db, listResidualsInput.parse({ limit: 1 }));
    // Osh: 10 - 2.7 = 7.3 left, 1 written off, 6.3 carried. Choy: 20 - 3 = 17 carried.
    expect(all.totals).toEqual({
      CARRY_TO_NEXT: { count: 2, quantity: '23.3' },
      WRITE_OFF: { count: 1, quantity: '1' },
    });
    expect(all).toMatchObject({ totalCount: 3, totalPages: 3, page: 1, limit: 1 });
    expect(all.items).toHaveLength(1);
  });

  it('applying carried leftovers needs an open shift and only touches pending carries', async () => {
    const ids = (await t.db.residual.findMany()).map((r) => r.id);
    const closed = (await t.db.session.findFirstOrThrow()).id;
    await expect(
      applyResiduals(t.db, { residualIds: ids, targetSessionId: closed }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const next = await openSession(t.db, actor, {
      items: [{ menuItemId: choy, initialQuantity: '1' }],
    });
    // Opening already applied every pending carry (legacy parity), so nothing is left to apply.
    expect(await applyResiduals(t.db, { residualIds: ids, targetSessionId: next.id })).toBe(0);
  });
});
