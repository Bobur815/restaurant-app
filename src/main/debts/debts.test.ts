import {
  editCheckInput,
  listChecksInput,
  menuItemInput,
  payOrderInput,
  receiptSettingsInput,
  saveOpenOrderInput,
  saveTableOrderInput,
  salesReportInput,
} from '@shared/schemas';
import type { OrderDto } from '@shared/types';
import { dec, sum } from '@shared/utils/decimal';
import { dayKey, type Actor } from '../domain/db';
import { createMenuItem } from '../menu/menu-items';
import { saveOpenOrder, saveTableOrder } from '../orders/orders';
import { cancelPaidOrder, editCheck, listChecks, payOrder } from '../payments/payments';
import { buildReceiptHtml } from '../printing/receipt';
import { salesReport } from '../reports/reports';
import { openSession } from '../sessions/sessions';
import { updateSettings } from '../settings/settings';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import {
  assignDebt,
  getDebtor,
  listDebtors,
  repayDebt,
  voidRepayment,
  writeOffDebt,
} from './debts';

jest.setTimeout(60_000);

let t: TestDb;
let cashier: Actor;
let admin: Actor;
let dish: number; // 10 000
let table = 0;
const today = dayKey(new Date());
const ALI = { phone: '998901112233', name: 'Ali', dueDate: null };

beforeAll(async () => {
  t = await createTestDb();
  cashier = await createUser(t.db, { username: 'kassir' });
  admin = await createUser(t.db, { username: 'boss', role: 'ADMIN' });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  dish = (
    await createMenuItem(
      t.db,
      menuItemInput.parse({ nameUz: 'Lagmon', price: '10000', categoryId }),
    )
  ).id;
  await openSession(t.db, cashier, { items: [{ menuItemId: dish, initialQuantity: '500' }] });
});
afterAll(() => t.close());

/** A new table order of `n` dishes (10 000 each). */
async function order(n: number): Promise<OrderDto> {
  table = (table % 10) + 1;
  return saveTableOrder(
    t.db,
    cashier,
    saveTableOrderInput.parse({ tableNumber: table, lines: [{ menuItemId: dish, quantity: n }] }),
  );
}
const pay = (o: OrderDto, input: Record<string, unknown>) =>
  payOrder(t.db, cashier, payOrderInput.parse({ orderId: o.id, ...input }));
const customerId = async (phone: string) =>
  (await t.db.customer.findUniqueOrThrow({ where: { phone } })).id;

describe('split payment', () => {
  it('cash + card with change: one row per method, cash net of change, order "mixed"', async () => {
    const o = await order(10); // 100 000
    const paid = await pay(o, {
      tenders: [
        { method: 'card', amount: '45000' },
        { method: 'cash', amount: '60000' },
      ],
    });
    expect(paid.paymentMethod).toBe('mixed');
    expect(paid.payments.map((p) => [p.method, p.amount, p.status])).toEqual([
      ['cash', '55000', 'paid'],
      ['card', '45000', 'paid'],
    ]);
  });

  it('refuses lines that do not cover the total, or card/Click/debt over it', async () => {
    const o = await order(2); // 20 000
    await expect(
      pay(o, { tenders: [{ method: 'cash', amount: '19999.99' }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'short', remaining: '0.01' },
    });
    await expect(
      pay(o, {
        tenders: [
          { method: 'card', amount: '15000' },
          { method: 'click', amount: '10000' },
        ],
      }),
    ).rejects.toMatchObject({ details: { reason: 'nonCashOver' } });
    // Still unpaid and payable.
    expect((await pay(o, { method: 'click' })).status).toBe('completed');
  });

  it('the legacy single method still pays the whole total', async () => {
    const o = await order(3);
    expect((await pay(o, { method: 'card' })).payments).toMatchObject([
      { method: 'card', amount: '30000' },
    ]);
  });
});

describe('debt', () => {
  it('needs a customer: by phone (a new one with a name), or the order its own', async () => {
    const o = await order(1);
    await expect(pay(o, { method: 'debt' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { field: 'debtCustomer.phone' },
    });
    await expect(
      pay(o, { method: 'debt', debtCustomer: { phone: '+998 93 000 11 22' } }),
    ).rejects.toMatchObject({ details: { field: 'debtCustomer.name' } });

    // A takeaway order with a customer: the debt goes on that customer, no form needed.
    const takeaway = await saveOpenOrder(
      t.db,
      cashier,
      saveOpenOrderInput.parse({
        orderType: 'TAKEAWAY',
        customerPhone: '+998 93 555 44 33',
        customerName: 'Vali',
        lines: [{ menuItemId: dish, quantity: 1 }],
      }),
    );
    const paid = await pay(takeaway, { method: 'debt' });
    expect(paid.payments[0]).toMatchObject({
      method: 'debt',
      status: 'pending',
      customerName: 'Vali',
    });
    await pay(o, { method: 'cash' });
  });

  it('part of a check on debt, with a due date; repaid partly, then fully; never more', async () => {
    const o = await order(8); // 80 000
    const paid = await pay(o, {
      tenders: [
        { method: 'cash', amount: '50000' },
        { method: 'debt', amount: '30000' },
      ],
      debtCustomer: { ...ALI, dueDate: '2026-12-31' },
    });
    expect(paid.payments.find((p) => p.method === 'debt')).toMatchObject({
      amount: '30000',
      status: 'pending',
      customerName: 'Ali',
    });
    const ali = await customerId(ALI.phone);
    expect(
      (await listDebtors(t.db, { includeSettled: false })).find((d) => d.customerId === ali),
    ).toMatchObject({
      balance: '30000',
      openChecks: 1,
      overdue: false,
    });

    let detail = await repayDebt(t.db, cashier, {
      customerId: ali,
      amount: '10000',
      method: 'cash',
      note: null,
    });
    expect(detail.balance).toBe('20000');
    expect(detail.charges[0]).toMatchObject({ settledAt: null });

    await expect(
      repayDebt(t.db, cashier, { customerId: ali, amount: '20000.01', method: 'card', note: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'amount', balance: '20000' } });

    detail = await repayDebt(t.db, cashier, {
      customerId: ali,
      amount: '20000',
      method: 'click',
      note: null,
    });
    expect(detail.balance).toBe('0');
    expect(detail.charges[0]!.settledAt).not.toBeNull();
    expect(
      (await listDebtors(t.db, { includeSettled: false })).map((d) => d.customerId),
    ).not.toContain(ali);
    expect(
      (await listDebtors(t.db, { includeSettled: true })).find((d) => d.customerId === ali),
    ).toMatchObject({ balance: '0', openChecks: 0 });
  });

  it('repayments cover the oldest debt first; voiding one re-opens what it covered', async () => {
    const ali = await customerId(ALI.phone);
    const first = await pay(await order(3), { method: 'debt', debtCustomer: ALI }); // 30 000
    const second = await pay(await order(2), { method: 'debt', debtCustomer: ALI }); // 20 000
    const detail = await repayDebt(t.db, cashier, {
      customerId: ali,
      amount: '35000',
      method: 'cash',
      note: 'Qisman',
    });
    const charge = (o: OrderDto) => detail.charges.find((c) => c.orderId === o.id)!;
    expect(detail.balance).toBe('15000');
    expect(charge(first).settledAt).not.toBeNull();
    expect(charge(second).settledAt).toBeNull();

    const repayment = detail.repayments.find((r) => r.note === 'Qisman')!;
    const after = await voidRepayment(t.db, admin, {
      repaymentId: repayment.id,
      reason: 'Xato kiritilgan',
    });
    expect(after.balance).toBe('50000');
    expect(after.charges.filter((c) => c.settledAt === null)).toHaveLength(2);
    expect(after.repayments.find((r) => r.id === repayment.id)).toMatchObject({
      voidedBy: 'boss',
      voidReason: 'Xato kiritilgan',
    });
    await expect(
      voidRepayment(t.db, admin, { repaymentId: repayment.id, reason: 'Yana' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a write-off forgives debt; it counts as forgiven, not as money received', async () => {
    const ali = await customerId(ALI.phone);
    const detail = await writeOffDebt(t.db, admin, {
      customerId: ali,
      amount: '5000',
      note: 'Chegirma',
    });
    expect(detail.balance).toBe('45000');
    const day = (await salesReport(t.db, salesReportInput.parse({ start: today, end: today })))
      .daily[0]!;
    expect(day.writtenOff).toBe('5000');
    // Repaid today: 10 000 cash + 20 000 Click (the voided 35 000 does not count).
    expect(day).toMatchObject({
      repayments: '30000',
      repaymentCash: '10000',
      repaymentClick: '20000',
    });
    expect(day.received).toBe(sum([day.cash, day.card, day.click, '30000']).toFixed());
  });

  it('a check whose debt was repaid cannot be deleted or edited away until the repayment is voided', async () => {
    const bek = { phone: '998977770000', name: 'Bek', dueDate: null };
    const o = await pay(await order(4), { method: 'debt', debtCustomer: bek }); // 40 000
    const bekId = await customerId(bek.phone);
    const { repayments } = await repayDebt(t.db, cashier, {
      customerId: bekId,
      amount: '25000',
      method: 'cash',
      note: null,
    });

    await expect(cancelPaidOrder(t.db, o.orderNumber)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'DEBT_REPAID' },
    });
    await expect(
      editCheck(
        t.db,
        admin,
        editCheckInput.parse({
          orderNumber: o.orderNumber,
          tenders: [{ method: 'cash', amount: '40000' }],
        }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'DEBT_REPAID' } });

    // Editing it to a smaller debt that still covers the repayment is fine.
    const edited = await editCheck(
      t.db,
      admin,
      editCheckInput.parse({
        orderNumber: o.orderNumber,
        tenders: [
          { method: 'cash', amount: '10000' },
          { method: 'debt', amount: '30000' },
        ],
        debtCustomer: bek,
      }),
    );
    expect(edited.paymentMethod).toBe('mixed');
    expect((await getDebtor(t.db, bekId, { full: true })).balance).toBe('5000');

    await voidRepayment(t.db, admin, { repaymentId: repayments[0]!.id, reason: 'Qaytarildi' });
    expect((await cancelPaidOrder(t.db, o.orderNumber)).status).toBe('cancelled');
    expect((await getDebtor(t.db, bekId, { full: true })).balance).toBe('0');
  });

  it('imported debt without a customer: open rows listed under "unknown", assignable once', async () => {
    const legacy = await order(1);
    await pay(legacy, { method: 'cash' });
    // As the legacy import writes them: an open one and one the old app had marked paid.
    const [open, paid] = await Promise.all([
      t.db.payment.create({
        data: { orderId: legacy.id, amount: '7000', method: 'debt', status: 'pending' },
      }),
      t.db.payment.create({
        data: { orderId: legacy.id, amount: '3000', method: 'debt', status: 'paid' },
      }),
    ]);
    const unknown = (await listDebtors(t.db, { includeSettled: false })).find(
      (d) => d.customerId === null,
    )!;
    expect(unknown).toMatchObject({ balance: '7000', openChecks: 1, name: null });
    expect((await getDebtor(t.db, null, { full: true })).charges.map((c) => c.paymentId)).toEqual([
      open.id,
    ]);

    await expect(
      assignDebt(t.db, { paymentId: paid.id, phone: '998900000077', name: 'Gulnora' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const assigned = await assignDebt(t.db, {
      paymentId: open.id,
      phone: '998900000077',
      name: 'Gulnora',
    });
    expect(assigned).toMatchObject({ balance: '7000', customer: { name: 'Gulnora' } });
    expect(
      (await listDebtors(t.db, { includeSettled: false })).find((d) => d.customerId === null),
    ).toBeUndefined();
  });

  it('switched off in settings: no split, no debt', async () => {
    await updateSettings(t.db, { splitPaymentEnabled: false, debtEnabled: false });
    const o = await order(2);
    await expect(
      pay(o, {
        tenders: [
          { method: 'cash', amount: '10000' },
          { method: 'card', amount: '10000' },
        ],
      }),
    ).rejects.toMatchObject({ details: { reason: 'SPLIT_DISABLED' } });
    await expect(pay(o, { method: 'debt', debtCustomer: ALI })).rejects.toMatchObject({
      details: { reason: 'DEBT_DISABLED' },
    });
    await updateSettings(t.db, { splitPaymentEnabled: true, debtEnabled: true });
    await pay(o, { method: 'cash' });
  });
});

describe('checks, reports and receipt with split payments', () => {
  it('a split check is one row with its methods and its open debt', async () => {
    const o = await pay(await order(6), {
      tenders: [
        { method: 'card', amount: '20000' },
        { method: 'debt', amount: '40000' },
      ],
      debtCustomer: ALI,
    });
    const checks = await listChecks(
      t.db,
      listChecksInput.parse({ startDate: today, endDate: today }),
    );
    expect(checks.filter((c) => c.orderId === o.id)).toEqual([
      expect.objectContaining({
        amount: '60000',
        methods: ['card', 'debt'],
        debtAmount: '40000',
        debtOpen: '40000',
        status: 'pending',
      }),
    ]);
    const debtOnly = await listChecks(
      t.db,
      listChecksInput.parse({
        startDate: today,
        endDate: today,
        method: 'card',
        status: 'pending',
      }),
    );
    expect(debtOnly.map((c) => c.orderId)).toEqual([o.id]);
  });

  it('reports count a split order once (orders, dishes) and its payments by method', async () => {
    const before = (await salesReport(t.db, salesReportInput.parse({ start: today, end: today })))
      .daily[0]!;
    const dishesBefore = (
      await salesReport(t.db, salesReportInput.parse({ start: today, end: today }))
    ).productsByDate[0]!.products[0]!.quantity;
    await pay(await order(5), {
      tenders: [
        { method: 'cash', amount: '20000' },
        { method: 'card', amount: '20000' },
        { method: 'click', amount: '10000' },
      ],
    });
    const report = await salesReport(t.db, salesReportInput.parse({ start: today, end: today }));
    const after = report.daily[0]!;
    expect(after.numberOfOrders).toBe(before.numberOfOrders + 1);
    expect(dec(after.total).minus(before.total).toFixed()).toBe('50000');
    expect(dec(after.cash).minus(before.cash).toFixed()).toBe('20000');
    expect(dec(report.productsByDate[0]!.products[0]!.quantity).minus(dishesBefore).toFixed()).toBe(
      '5',
    );
  });

  it('the receipt lists every method and who owes the debt part, with the due date', async () => {
    const o = await pay(await order(2), {
      tenders: [
        { method: 'cash', amount: '5000' },
        { method: 'debt', amount: '15000' },
      ],
      debtCustomer: { ...ALI, dueDate: '2026-11-30' },
    });
    const html = buildReceiptHtml(o, {
      ...receiptSettingsInput.parse({ restaurantName: 'Shoxona' }),
      extraPhones: '',
      logoPath: null,
    });
    expect(html).toMatch(/Naqd<\/span><span class="amount">5\s000/);
    expect(html).toMatch(/Nasiya \(Ali\)<\/span><span class="amount">15\s000/);
    expect(html).toContain('30.11.2026');
  });
});

describe('review fixes (F1-C)', () => {
  it('a free check (total 0) can be paid and closed', async () => {
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    const free = (
      await createMenuItem(t.db, menuItemInput.parse({ nameUz: 'Suv', price: '0', categoryId }))
    ).id;
    await t.db.sessionItem.create({
      data: {
        sessionId: (await t.db.session.findFirstOrThrow({ where: { status: 'open' } })).id,
        menuItemId: free,
        initialQuantity: 10,
      },
    });
    const o = await saveTableOrder(
      t.db,
      cashier,
      saveTableOrderInput.parse({ tableNumber: 9, lines: [{ menuItemId: free, quantity: 1 }] }),
    );
    expect(o.totalAmount).toBe('0');
    const paid = await pay(o, { tenders: [{ method: 'cash', amount: '0' }] });
    expect(paid).toMatchObject({
      status: 'completed',
      payments: [{ method: 'cash', amount: '0' }],
    });
  });

  it('staff see a debtor without address and note; a customer without debt is no debtor', async () => {
    const ali = await customerId(ALI.phone);
    await t.db.customer.update({
      where: { id: ali },
      data: { address: 'Sergeli 5', note: 'Faqat admin uchun' },
    });
    expect((await getDebtor(t.db, ali, { full: false })).customer).toMatchObject({
      name: 'Ali',
      address: null,
      note: null,
    });
    expect((await getDebtor(t.db, ali, { full: true })).customer).toMatchObject({
      address: 'Sergeli 5',
      note: 'Faqat admin uchun',
    });
    const deliveryOnly = await t.db.customer.create({ data: { phone: '998977000001' } });
    await expect(getDebtor(t.db, deliveryOnly.id, { full: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('due dates: real calendar days, at most a year ahead, never in the past for a new debt', async () => {
    const parse = (dueDate: string) =>
      payOrderInput.safeParse({ orderId: 1, method: 'debt', debtCustomer: { ...ALI, dueDate } });
    expect(parse('2026-02-31').success).toBe(false);
    expect(parse('2099-01-01').success).toBe(false);
    await expect(
      pay(await order(1), { method: 'debt', debtCustomer: { ...ALI, dueDate: '2020-01-01' } }),
    ).rejects.toMatchObject({ details: { field: 'debtCustomer.dueDate' } });
  });

  it('a debt on a known phone never renames or re-activates that customer', async () => {
    const ali = await customerId(ALI.phone);
    await t.db.customer.update({ where: { id: ali }, data: { isActive: false } });
    await pay(await order(1), { method: 'debt', debtCustomer: { ...ALI, name: 'Boshqa ism' } });
    expect(await t.db.customer.findUniqueOrThrow({ where: { id: ali } })).toMatchObject({
      name: 'Ali',
      isActive: false,
    });
    await t.db.customer.update({ where: { id: ali }, data: { isActive: true } });
  });

  it('the status filter matches the status shown (open debt = pending, never paid)', async () => {
    const o = await pay(await order(2), {
      tenders: [
        { method: 'cash', amount: '10000' },
        { method: 'debt', amount: '10000' },
      ],
      debtCustomer: ALI,
    });
    const paid = await listChecks(
      t.db,
      listChecksInput.parse({ startDate: today, endDate: today, status: 'paid' }),
    );
    expect(paid.map((c) => c.orderId)).not.toContain(o.id);
  });

  it('check edit: stale version and legacy-settled checks refused; the cashier stays; debt kept when debt is off', async () => {
    const o = await pay(await order(1), { method: 'debt', debtCustomer: ALI });
    await expect(
      editCheck(
        t.db,
        admin,
        editCheckInput.parse({
          orderNumber: o.orderNumber,
          tenders: [{ method: 'cash', amount: '10000' }],
          expectedVersion: o.version - 1,
        }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'STALE' } });

    await updateSettings(t.db, { debtEnabled: false });
    const edited = await editCheck(
      t.db,
      admin,
      editCheckInput.parse({
        orderNumber: o.orderNumber,
        tenders: [{ method: 'debt', amount: '10000' }],
        debtCustomer: ALI,
        expectedVersion: o.version,
      }),
    );
    await updateSettings(t.db, { debtEnabled: true });
    expect(edited.payments).toMatchObject([{ method: 'debt' }]);
    const row = await t.db.payment.findFirstOrThrow({ where: { orderId: o.id } });
    expect(row.createdById).toBe(cashier.id);

    const legacy = await pay(await order(1), { method: 'cash' });
    await t.db.payment.create({
      data: { orderId: legacy.id, amount: '1', method: 'debt', status: 'paid' },
    });
    await expect(
      editCheck(
        t.db,
        admin,
        editCheckInput.parse({
          orderNumber: legacy.orderNumber,
          tenders: [{ method: 'cash', amount: '10000' }],
        }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'LEGACY_SETTLED' } });
  });

  it('an old debt assigned later never re-opens debt the customer already paid off', async () => {
    const zed = { phone: '998935550000', name: 'Zed', dueDate: null };
    const c = await pay(await order(10), { method: 'debt', debtCustomer: zed }); // 100 000
    const zedId = await customerId(zed.phone);
    await repayDebt(t.db, cashier, {
      customerId: zedId,
      amount: '100000',
      method: 'cash',
      note: null,
    });
    const legacy = await pay(await order(1), { method: 'cash' });
    const old = await t.db.payment.create({
      data: {
        orderId: legacy.id,
        amount: '5000',
        method: 'debt',
        status: 'pending',
        paidAt: new Date('2025-01-01T12:00:00'),
      },
    });
    const detail = await assignDebt(t.db, { paymentId: old.id, phone: zed.phone, name: null });
    expect(detail.balance).toBe('5000');
    expect(detail.charges.find((x) => x.orderId === c.id)!.settledAt).not.toBeNull();
    expect(detail.charges.find((x) => x.paymentId === old.id)!.settledAt).toBeNull();
  });

  it('an order paid over two days counts once, on its first day, in any range', async () => {
    const o = await pay(await order(1), { method: 'cash' });
    // As a legacy import can hold it: a second payment of the same order on a later day.
    const later = new Date();
    later.setDate(later.getDate() + 1);
    await t.db.payment.create({
      data: { orderId: o.id, amount: '0', method: 'cash', status: 'paid', paidAt: later },
    });
    const tomorrow = dayKey(later);
    const day2 = await salesReport(
      t.db,
      salesReportInput.parse({ start: tomorrow, end: tomorrow }),
    );
    expect(day2.daily[0]?.numberOfOrders ?? 0).toBe(0);
    expect(day2.productsByDate).toEqual([]);
  });
});
