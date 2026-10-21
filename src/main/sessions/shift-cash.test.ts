import {
  addCashMovementInput,
  closeSessionInput,
  menuItemInput,
  openSessionInput,
  saveTableOrderInput,
} from '@shared/schemas';
import type { ReceiptSettingsDto } from '@shared/types';
import { repayDebt, voidRepayment } from '../debts/debts';
import type { Actor } from '../domain/db';
import { createMenuItem } from '../menu/menu-items';
import { saveTableOrder } from '../orders/orders';
import { cancelPaidOrder, payOrder } from '../payments/payments';
import { buildShiftReportHtml, printShiftReport } from '../printing/shift-report';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { addCashMovement, getCashSummary } from './cash';
import {
  closeSession,
  getLastUnlimited,
  getOpenSession,
  getSession,
  openSession,
  updateOpenSession,
} from './sessions';

/**
 * Feature F6: unlimited (∞) dishes in a shift and the shift's cash drawer. One shift is walked
 * through in order: open with ∞ and opening cash, sell, pay with split / debt, repay debt in cash
 * (one repayment voided), cash in/out, close with a shortage, then corrections after the close.
 */

jest.setTimeout(60_000);

let t: TestDb;
let admin: Actor;
let choy: number;
let osh: number;
let sessionId: number;
let firstOrderNumber: string;

beforeAll(async () => {
  t = await createTestDb();
  admin = await createUser(t.db, { username: 'admin', role: 'ADMIN' });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  choy = (
    await createMenuItem(t.db, menuItemInput.parse({ nameUz: 'Choy', price: '3000', categoryId }))
  ).id;
  osh = (
    await createMenuItem(t.db, menuItemInput.parse({ nameUz: 'Osh', price: '25000', categoryId }))
  ).id;
});
afterAll(() => t.close());

const order = (tableNumber: number, lines: unknown[]) =>
  saveTableOrder(t.db, admin, saveTableOrderInput.parse({ tableNumber, lines }));

describe('a shift with ∞ dishes and a cash drawer', () => {
  it('opens with an unlimited dish (quantity ignored) and the opening cash', async () => {
    const s = await openSession(
      t.db,
      admin,
      openSessionInput.parse({
        openingCash: '100000',
        items: [
          { menuItemId: choy, initialQuantity: '5', unlimited: true },
          { menuItemId: osh, initialQuantity: '2' },
        ],
      }),
    );
    sessionId = s.id;
    expect(s.openingCash).toBe('100000');
    expect(s.countedCash).toBeNull();
    expect(s.items.find((i) => i.menuItemId === choy)).toMatchObject({
      unlimited: true,
      initialQuantity: '0',
      remainingQuantity: '0',
    });
  });

  it('sells an ∞ dish past any number and still counts it; a limited dish still stops', async () => {
    const first = await order(1, [{ menuItemId: choy, quantity: 50 }]);
    firstOrderNumber = first.orderNumber;
    expect(
      (await getSession(t.db, sessionId)).items.find((i) => i.menuItemId === choy),
    ).toMatchObject({ soldQuantity: '50', unlimited: true });
    await expect(order(2, [{ menuItemId: osh, quantity: 3 }])).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { shortages: [expect.objectContaining({ menuItemId: osh, remaining: '2' })] },
    });
  });

  it('switching ∞ off needs at least what is sold; switching it on lifts the limit', async () => {
    await expect(
      updateOpenSession(t.db, {
        sessionId,
        items: [{ menuItemId: choy, initialQuantity: '10', unlimited: false }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await updateOpenSession(t.db, { sessionId, items: [{ menuItemId: osh, unlimited: true }] });
    await expect(order(2, [{ menuItemId: osh, quantity: 3 }])).resolves.toBeTruthy();
  });

  it('counts the drawer: split tender, debt, cash repayments in the shift (voided left out), cash in/out', async () => {
    const first = (await t.db.order.findUniqueOrThrow({ where: { orderNumber: firstOrderNumber } }))
      .id;
    // 50 tea = 150 000: 100 000 cash + 50 000 card.
    await payOrder(t.db, admin, {
      orderId: first,
      tenders: [
        { method: 'cash', amount: '100000' },
        { method: 'card', amount: '50000' },
      ],
    });
    // 3 osh = 75 000 on debt.
    const second = (await getOpenSession(t.db))!;
    const pending = await t.db.order.findFirstOrThrow({
      where: { sessionId: second.id, status: 'pending' },
    });
    await payOrder(t.db, admin, {
      orderId: pending.id,
      method: 'debt',
      debtCustomer: { phone: '998901112233', name: 'Ali', dueDate: null },
    });
    const customerId = (await t.db.customer.findFirstOrThrow()).id;
    await repayDebt(t.db, admin, { customerId, amount: '10000', method: 'cash', note: null });
    await repayDebt(t.db, admin, { customerId, amount: '7000', method: 'card', note: null });
    await repayDebt(t.db, admin, { customerId, amount: '5000', method: 'cash', note: null });
    const voided = await t.db.debtRepayment.findFirstOrThrow({ where: { amount: '5000' } });
    await voidRepayment(t.db, admin, { repaymentId: voided.id, reason: 'xato' });

    await addCashMovement(
      t.db,
      admin,
      addCashMovementInput.parse({ type: 'PAY_IN', amount: '20000', note: 'Mayda pul' }),
    );
    await addCashMovement(
      t.db,
      admin,
      addCashMovementInput.parse({ type: 'PAY_OUT', amount: '30000', note: 'Non' }),
    );
    // More out than the drawer should hold is refused.
    await expect(
      addCashMovement(
        t.db,
        admin,
        addCashMovementInput.parse({ type: 'PAY_OUT', amount: '500000' }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const sum = await getCashSummary(t.db, sessionId);
    expect(sum).toMatchObject({
      status: 'open',
      openingCash: '100000',
      sales: { cash: '100000', card: '50000', click: '0', debt: '75000' },
      salesTotal: '225000',
      checksCount: 2,
      debtRepaymentsCash: '10000',
      payIn: '20000',
      payOut: '30000',
      // 100 000 + 100 000 + 10 000 + 20 000 - 30 000
      expectedCash: '200000',
      countedCash: null,
      difference: null,
    });
    expect(sum.movements.map((m) => [m.type, m.amount, m.note, m.createdBy])).toEqual([
      ['PAY_IN', '20000', 'Mayda pul', admin.fullName],
      ['PAY_OUT', '30000', 'Non', admin.fullName],
    ]);
  });

  it('closes with the counted cash; expected is frozen; ∞ dishes leave no leftover', async () => {
    await expect(
      closeSession(
        t.db,
        admin,
        closeSessionInput.parse({
          sessionId,
          countedCash: '195000',
          actions: [{ menuItemId: choy, writeOffQuantity: '1' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const result = await closeSession(
      t.db,
      admin,
      closeSessionInput.parse({ sessionId, countedCash: '195000' }),
    );
    expect(result.carried).toEqual([]);
    expect(result.writtenOff).toEqual([]);
    const s = await getSession(t.db, sessionId);
    expect(s).toMatchObject({ countedCash: '195000', expectedCash: '200000' });
    expect(await getCashSummary(t.db, sessionId)).toMatchObject({
      expectedCash: '200000',
      countedCash: '195000',
      difference: '-5000',
    });
    expect((await getLastUnlimited(t.db)).sort()).toEqual([choy, osh].sort());
  });

  it('after close: no more cash movements, and a later check cancellation does not move the count', async () => {
    await expect(
      addCashMovement(t.db, admin, addCashMovementInput.parse({ type: 'PAY_IN', amount: '1000' })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await cancelPaidOrder(t.db, firstOrderNumber);
    const sum = await getCashSummary(t.db, sessionId);
    expect(sum.sales.cash).toBe('0');
    expect(sum.expectedCash).toBe('200000');
    expect(sum.difference).toBe('-5000');
    // The 100 000 cash taken out by the cancellation shows as its own line: still adds up.
    expect(sum.correctionAfterClose).toBe('100000');
  });

  it('Z-report: escaped, with the count; X-report refused for a closed shift', async () => {
    // The report reads only the name and the language from the receipt settings.
    const settings = { restaurantName: '<b>Shoxona</b>', locale: 'uz-UZ' } as ReceiptSettingsDto;
    const html = buildShiftReportHtml(
      'Z',
      await getSession(t.db, sessionId),
      await getCashSummary(t.db, sessionId),
      settings,
    );
    expect(html).toContain('Z-HISOBOT');
    expect(html).toContain('Kamomad');
    expect(html).toContain('&lt;b&gt;Shoxona&lt;/b&gt;');
    expect(html).not.toContain('<b>Shoxona');
    expect(html).toContain('Choy (cheksiz)');
    expect(html).toContain('Mayda pul');
    const printer = { print: jest.fn(), list: jest.fn(), preview: jest.fn() };
    await expect(
      printShiftReport(t.db, printer as never, { sessionId, kind: 'X' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(printer.print).not.toHaveBeenCalled();
  });
});

describe('the next shift', () => {
  it('cancelling a cash check in the open shift lowers expected cash and gives ∞ stock back', async () => {
    await openSession(t.db, admin, {
      openingCash: '50000',
      items: [
        { menuItemId: choy, unlimited: true },
        { menuItemId: osh, initialQuantity: '4' },
      ],
    });
    const o = await order(1, [{ menuItemId: choy, quantity: 10 }]);
    await payOrder(t.db, admin, { orderId: o.id, method: 'cash' });
    const open = (await getOpenSession(t.db))!;
    expect((await getCashSummary(t.db, open.id)).expectedCash).toBe('80000');

    await cancelPaidOrder(t.db, o.orderNumber);
    expect((await getCashSummary(t.db, open.id)).expectedCash).toBe('50000');
    expect(
      (await getSession(t.db, open.id)).items.find((i) => i.menuItemId === choy),
    ).toMatchObject({ soldQuantity: '0', unlimited: true });
  });

  it('switching ∞ off sets a real limit again', async () => {
    const open = (await getOpenSession(t.db))!;
    await updateOpenSession(t.db, {
      sessionId: open.id,
      items: [{ menuItemId: choy, initialQuantity: '2', unlimited: false }],
    });
    await expect(order(2, [{ menuItemId: choy, quantity: 3 }])).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { shortages: [expect.objectContaining({ menuItemId: choy, remaining: '2' })] },
    });
  });

  it('a cash debt repayment needs an open shift (its drawer); card does not', async () => {
    const open = (await getOpenSession(t.db))!;
    await closeSession(
      t.db,
      admin,
      closeSessionInput.parse({ sessionId: open.id, countedCash: '50000' }),
    );
    const customerId = (await t.db.customer.findFirstOrThrow()).id;
    await expect(
      repayDebt(t.db, admin, { customerId, amount: '1000', method: 'cash', note: null }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NO_OPEN_SHIFT' } });
    await expect(
      repayDebt(t.db, admin, { customerId, amount: '1000', method: 'card', note: null }),
    ).resolves.toBeTruthy();
  });
});
