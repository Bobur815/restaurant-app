import {
  closeSessionInput,
  editCheckInput,
  menuItemInput,
  payOrderInput,
  receiptSettingsInput,
  saveTableOrderInput,
} from '@shared/schemas';
import type { AppEvent } from '@shared/ipc';
import type { OrderDto } from '@shared/types';
import type { Actor } from '../domain/db';
import { repayDebt, voidRepayment, writeOffDebt } from '../debts/debts';
import { plainCipher } from '../lan/config';
import { createMenuItem } from '../menu/menu-items';
import { getOrder, saveTableOrder } from '../orders/orders';
import { assertCheckCancellable, cancelPaidOrder, editCheck, payOrder } from '../payments/payments';
import { closeSession, openSession } from '../sessions/sessions';
import { RECEIPT_SETTINGS_ID } from '../settings/settings';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { closedVcrUrl, FAKE_TERMINAL, startFakeVcr, type FakeVcr } from '../test-utils/fake-vcr';
import { receiptCode, receiptCodePrefix, saveFiscalConfig } from './config';
import { FiscalService } from './fiscal-service';

jest.setTimeout(60_000);

const MXIK = '10202001001000000';
const PASSWORD = 'kassa123';

let t: TestDb;
let vcr: FakeVcr;
let fiscal: FiscalService;
let cashier: Actor;
let dish: number; // 10 000
let table = 0;
const events: AppEvent[] = [];
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function configure(over: Record<string, unknown> = {}) {
  await saveFiscalConfig(t.db, plainCipher, {
    enabled: true,
    host: '127.0.0.1',
    port: 22298,
    login: 'cassir',
    password: PASSWORD,
    vatMode: 'nonPayer',
    defaultMxik: MXIK,
    defaultPackage: '',
    serviceMxik: '',
    servicePackage: '',
    deliveryMxik: '',
    deliveryPackage: '',
    ...over,
  });
}

beforeAll(async () => {
  t = await createTestDb();
  vcr = await startFakeVcr({ password: PASSWORD });
  cashier = await createUser(t.db, { username: 'kassir', role: 'ADMIN' });
  await t.db.receiptSettings.create({
    data: { id: RECEIPT_SETTINGS_ID, ...receiptSettingsInput.parse({ restaurantName: 'Test' }) },
  });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  dish = (
    await createMenuItem(
      t.db,
      menuItemInput.parse({ nameUz: 'Lagmon', price: '10000', categoryId }),
    )
  ).id;
  await openSession(t.db, cashier, { items: [{ menuItemId: dish, initialQuantity: '500' }] });
  await configure();
  fiscal = new FiscalService({
    getDb: () => t.db,
    cipher: plainCipher,
    urlOverride: vcr.url,
    timeoutMs: 2_000,
    busyRetryMs: [10],
    onChange: (e) => events.push(...e),
    log: quiet,
  });
});
afterAll(async () => {
  await vcr.close();
  await t.close();
});

async function order(n: number): Promise<OrderDto> {
  table = (table % 10) + 1;
  return saveTableOrder(
    t.db,
    cashier,
    saveTableOrderInput.parse({ tableNumber: table, lines: [{ menuItemId: dish, quantity: n }] }),
  );
}
const pay = (o: OrderDto, input: Record<string, unknown> = { method: 'cash' }) =>
  payOrder(t.db, cashier, payOrderInput.parse({ orderId: o.id, ...input }));
const row = (id: number) => t.db.order.findUniqueOrThrow({ where: { id } });
const sales = () => vcr.calls.filter((c) => c.method === 'Receipt.Sale');

describe('paying with fiscal receipts on', () => {
  it('queues the check and sends it: FISCALIZED with what VCR answered', async () => {
    const paid = await pay(await order(2));
    expect(paid.fiscal).toMatchObject({ status: 'PENDING' });
    expect(await fiscal.send(paid.id)).toBe('sent');
    const o = await row(paid.id);
    expect(o).toMatchObject({
      fiscalStatus: 'FISCALIZED',
      fiscalError: null,
      fiscalTerminalId: FAKE_TERMINAL,
    });
    expect(o.fiscalQrUrl).toMatch(/^https:\/\/ofd\.soliq\.uz\/check\?t=/);
    const sent = sales().at(-1)!.params as {
      code: string;
      positions: unknown[];
      payments: unknown[];
    };
    expect(sent.code).toBe(receiptCode(await receiptCodePrefix(t.db), paid.orderNumber));
    expect(sent.payments).toEqual([{ type: 1, value: 2_000_000 }]);
    expect(sent.positions).toEqual([
      expect.objectContaining({ icps: MXIK, amount: 2_000_000, quantity: 2000, vat_value: -1 }),
    ]);
    // VCR's Z-report was opened first, and the shift remembers which.
    expect(vcr.zOpen).toBe(true);
    expect(
      (await t.db.session.findFirstOrThrow({ where: { status: 'open' } })).fiscalZReportId,
    ).toBe(vcr.zId);
    expect(events).toContainEqual({ type: 'orders-changed', orderId: paid.id });
  });

  it('with fiscal receipts off nothing is queued or sent', async () => {
    await configure({ enabled: false });
    const before = vcr.calls.length;
    const paid = await pay(await order(1));
    expect(paid.fiscal).toBeNull();
    expect(await fiscal.send(paid.id)).toBe('skipped');
    expect(vcr.calls.length).toBe(before);
    await configure();
  });

  it('VCR off: the payment stands, the check waits (no attempt) and goes later', async () => {
    const paid = await pay(await order(1));
    const off = new FiscalService({
      getDb: () => t.db,
      cipher: plainCipher,
      urlOverride: await closedVcrUrl(), // nothing listens
      timeoutMs: 2_000,
      onChange: () => undefined,
      log: quiet,
    });
    expect(await off.send(paid.id)).toBe('pending');
    expect(await row(paid.id)).toMatchObject({
      status: 'completed',
      fiscalStatus: 'PENDING',
      fiscalAttempts: 0,
      fiscalError: expect.stringContaining("aloqa yo'q"),
    });
    expect(await fiscal.retryAll()).toMatchObject({ sent: 1, pending: 0 });
    expect((await row(paid.id)).fiscalStatus).toBe('FISCALIZED');
  });

  it('a lost answer: VCR registered it, so it is adopted, never sent twice', async () => {
    const paid = await pay(await order(3));
    vcr.failNext('Receipt.Sale', 'drop');
    const before = sales().length;
    expect(await fiscal.send(paid.id)).toBe('sent');
    expect(sales().length).toBe(before + 1);
    expect(vcr.methods().at(-1)).toBe('Receipt.GetInfo');
    expect((await row(paid.id)).fiscalStatus).toBe('FISCALIZED');
    const code = receiptCode(await receiptCodePrefix(t.db), paid.orderNumber);
    expect(vcr.receipts.filter((r) => r.Code === code)).toHaveLength(1);
  });

  it('a check sent before is looked up first and adopted, not sent again', async () => {
    const paid = await pay(await order(1));
    // VCR took it, but this till never heard (e.g. the app was closed mid-answer).
    vcr.failNext('Receipt.Sale', 'drop');
    vcr.failNext('Receipt.GetInfo', 704042);
    vcr.failNext('Receipt.GetInfo', 704042);
    expect(await fiscal.send(paid.id)).toBe('pending');
    expect(await row(paid.id)).toMatchObject({ fiscalStatus: 'PENDING', fiscalAttempts: 0 });
    const before = sales().length;
    expect(await fiscal.send(paid.id)).toBe('sent');
    expect(sales().length).toBe(before);
  });

  it('a data refusal is FAILED with the reason and an attempt; Qayta yuborish sends again', async () => {
    const paid = await pay(await order(1));
    vcr.failNext('Receipt.Sale', 705511);
    expect(await fiscal.send(paid.id)).toBe('failed');
    expect(await row(paid.id)).toMatchObject({
      fiscalStatus: 'FAILED',
      fiscalAttempts: 1,
      fiscalError: expect.stringContaining('MXIK'),
    });
    // A background kick does not resend a FAILED check.
    expect(await fiscal.sendWaiting(['PENDING'])).toMatchObject({ sent: 0 });
    expect(await fiscal.retry(paid.id)).toBe('sent');
    expect((await row(paid.id)).fiscalStatus).toBe('FISCALIZED');
  });

  it('a dish without MXIK fails before VCR is asked', async () => {
    await configure({ defaultMxik: '' });
    const paid = await pay(await order(1));
    const before = vcr.calls.length;
    expect(await fiscal.send(paid.id)).toBe('failed');
    expect(vcr.calls.length).toBe(before);
    expect((await row(paid.id)).fiscalError).toBe('MXIK kodi kiritilmagan: Lagmon');
    await configure();
    expect(await fiscal.retry(paid.id)).toBe('sent');
  });

  it('a Z-report closed behind our back (704010) is reopened once and the sale retried', async () => {
    vcr.zOpen = false; // closed in the REGOS app; the service still believes it is open
    const paid = await pay(await order(1));
    expect(await fiscal.send(paid.id)).toBe('sent');
    expect(vcr.zOpen).toBe(true);
  });

  it('a receipt under our code with another amount is not adopted', async () => {
    const paid = await pay(await order(1));
    const code = receiptCode(await receiptCodePrefix(t.db), paid.orderNumber);
    vcr.receipts.push({
      ...vcr.receipts[0]!,
      Id: 'old',
      Code: code,
      Amount: 123,
    });
    expect(await fiscal.send(paid.id)).toBe('failed');
    expect((await row(paid.id)).fiscalError).toContain('boshqa summali chek');
    vcr.receipts.pop();
    // Once the old receipt is gone, Qayta yuborish registers this check's own.
    expect(await fiscal.retry(paid.id)).toBe('sent');
  });
});

describe('debt', () => {
  const ALI = { phone: '998901112233', name: 'Ali', dueDate: null };

  it('waits until the debt is repaid, then goes with the debt part as cash', async () => {
    const paid = await pay(await order(5), {
      tenders: [
        { method: 'card', amount: '20000' },
        { method: 'debt', amount: '30000' },
      ],
      debtCustomer: ALI,
    });
    expect(paid.fiscal?.status).toBe('DEFERRED_DEBT');
    expect(await fiscal.send(paid.id)).toBe('skipped');
    const customerId = (await t.db.customer.findUniqueOrThrow({ where: { phone: ALI.phone } })).id;
    await repayDebt(t.db, cashier, { customerId, amount: '10000', method: 'cash', note: null });
    expect((await row(paid.id)).fiscalStatus).toBe('DEFERRED_DEBT');
    await repayDebt(t.db, cashier, { customerId, amount: '20000', method: 'card', note: null });
    expect((await row(paid.id)).fiscalStatus).toBe('PENDING');
    // Voided before it was sent: it waits again.
    const last = await t.db.debtRepayment.findFirstOrThrow({ orderBy: { id: 'desc' } });
    await voidRepayment(t.db, cashier, { repaymentId: last.id, reason: 'xato' });
    expect((await row(paid.id)).fiscalStatus).toBe('DEFERRED_DEBT');
    await repayDebt(t.db, cashier, { customerId, amount: '20000', method: 'cash', note: null });
    expect(await fiscal.send(paid.id)).toBe('sent');
    expect(sales().at(-1)!.params).toMatchObject({
      payments: [
        { type: 1, value: 3_000_000 },
        { type: 2, value: 2_000_000, card_type: 2 },
      ],
    });
  });

  it('a written-off debt is never fiscalised automatically', async () => {
    const BOB = { phone: '998905556677', name: 'Bob', dueDate: null };
    const paid = await pay(await order(1), { method: 'debt', debtCustomer: BOB });
    const customerId = (await t.db.customer.findUniqueOrThrow({ where: { phone: BOB.phone } })).id;
    await writeOffDebt(t.db, cashier, { customerId, amount: '10000', note: 'kechirildi' });
    expect((await row(paid.id)).fiscalStatus).toBe('DEFERRED_DEBT');
  });
});

describe('corrections', () => {
  it('a fiscalised check keeps its payment methods', async () => {
    const paid = await pay(await order(1));
    await fiscal.send(paid.id);
    await expect(
      editCheck(
        t.db,
        cashier,
        editCheckInput.parse({
          orderNumber: paid.orderNumber,
          tenders: [{ method: 'card', amount: '10000' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'FISCALIZED' } });
  });

  it('a check VCR holds unbeknown to us is adopted when someone tries to edit it', async () => {
    const paid = await pay(await order(1));
    vcr.failNext('Receipt.Sale', 'drop');
    vcr.failNext('Receipt.GetInfo', 704042);
    vcr.failNext('Receipt.GetInfo', 704042);
    await fiscal.send(paid.id); // pending: VCR has it, we do not know
    await expect(fiscal.beforeEdit(paid.orderNumber)).rejects.toMatchObject({
      details: { reason: 'FISCALIZED' },
    });
    expect((await row(paid.id)).fiscalStatus).toBe('FISCALIZED');
  });

  it('an unsent check is edited and follows its new payments', async () => {
    const paid = await pay(await order(1));
    await fiscal.beforeEdit(paid.orderNumber); // never sent: nothing to ask
    const edited = await editCheck(
      t.db,
      cashier,
      editCheckInput.parse({
        orderNumber: paid.orderNumber,
        tenders: [{ method: 'card', amount: '10000' }],
      }),
    );
    expect(edited.fiscal?.status).toBe('PENDING');
    await fiscal.send(paid.id);
    expect(sales().at(-1)!.params).toMatchObject({ payments: [{ type: 2, value: 1_000_000 }] });
  });

  it('delete: refused without a refund; refunded by the stored link, then cancelled', async () => {
    const paid = await pay(await order(1));
    await fiscal.send(paid.id);
    await expect(cancelPaidOrder(t.db, paid.orderNumber)).rejects.toMatchObject({
      details: { reason: 'FISCAL_REFUND_NEEDED' },
    });
    await fiscal.beforeDelete(paid.orderNumber);
    expect(await row(paid.id)).toMatchObject({
      fiscalStatus: 'REFUNDED',
      fiscalRefundSign: expect.any(String),
    });
    const cancelled = await cancelPaidOrder(t.db, paid.orderNumber);
    expect(cancelled.status).toBe('cancelled');
    expect(vcr.methods().at(-1)).toBe('Receipt.FullRefund');
  });

  it('delete with a masked link needs the paper QR, of this check', async () => {
    vcr.masked = true;
    const paid = await pay(await order(1));
    await fiscal.send(paid.id);
    vcr.masked = false;
    const o = await row(paid.id);
    expect(o.fiscalQrUrl).toBe('***');
    const real = vcr.receipts.at(-1)!.QRCodeURL;
    await expect(fiscal.beforeDelete(paid.orderNumber)).rejects.toMatchObject({
      details: { reason: 'RECEIPT_QR_NEEDED' },
    });
    const other = real.replace(FAKE_TERMINAL, 'VG999999999999');
    await expect(fiscal.beforeDelete(paid.orderNumber, other)).rejects.toMatchObject({
      details: { reason: 'RECEIPT_QR_OTHER' },
    });
    // A scanner may add a prefix or invisible characters: only the link is used.
    await fiscal.beforeDelete(paid.orderNumber, ` ${real}\u200b`);
    expect(await row(paid.id)).toMatchObject({
      fiscalStatus: 'REFUNDED',
      fiscalQrUrl: real,
      fiscalReceiptNo: vcr.receipts.at(-1)!.ReceiptNo,
    });
  });

  it('a check never sent is deleted without VCR', async () => {
    const paid = await pay(await order(1));
    const before = vcr.calls.length;
    await fiscal.beforeDelete(paid.orderNumber);
    await cancelPaidOrder(t.db, paid.orderNumber);
    expect(vcr.calls.length).toBe(before);
    // Cancelled checks do not count as waiting.
    expect((await fiscal.status()).pending).toBe(0);
  });

  it('duplicate: VCR prints a copy of a fiscalised check', async () => {
    const paid = await pay(await order(1));
    await fiscal.send(paid.id);
    await fiscal.duplicate(paid.id);
    expect(vcr.methods().at(-1)).toBe('Receipt.Duplicate');
  });
});

describe('settings and the shift', () => {
  it('the password is kept, never shown; an empty one keeps the saved one', async () => {
    const cfg = await fiscal.getConfig();
    expect(cfg).toMatchObject({
      enabled: true,
      hasPassword: true,
      defaultMxik: MXIK,
      urlOverride: true,
    });
    expect(JSON.stringify(cfg)).not.toContain(PASSWORD);
    await fiscal.setConfig({ ...cfg, password: '' });
    expect((await fiscal.testConnection()).terminalId).toBe(FAKE_TERMINAL);
  });

  it('a wrong password is VCR’s Uzbek message', async () => {
    const cfg = await fiscal.getConfig();
    await fiscal.setConfig({ ...cfg, password: 'wrong' });
    await expect(fiscal.testConnection()).rejects.toMatchObject({
      message: expect.stringContaining("login yoki parol noto'g'ri"),
    });
    await fiscal.setConfig({ ...cfg, password: PASSWORD });
  });

  it('closing the shift sends what waits, then closes the Z-report', async () => {
    const paid = await pay(await order(1));
    const session = await t.db.session.findFirstOrThrow({ where: { status: 'open' } });
    await closeSession(
      t.db,
      cashier,
      closeSessionInput.parse({ sessionId: session.id, countedCash: '0', actions: [] }),
    );
    expect(await fiscal.afterShiftClose(session.id)).toBeNull();
    expect((await row(paid.id)).fiscalStatus).toBe('FISCALIZED');
    expect(vcr.zOpen).toBe(false);
    expect(
      (await t.db.session.findUniqueOrThrow({ where: { id: session.id } })).fiscalZClosedAt,
    ).not.toBeNull();
    const z = await fiscal.zReport();
    expect(z).toMatchObject({ open: false, terminalId: FAKE_TERMINAL });
  });

  it('a VCR refusing the Z-report close is a warning, not an error', async () => {
    const s = await openSession(t.db, cashier, {
      items: [{ menuItemId: dish, initialQuantity: '5' }],
    });
    fiscal.afterShiftOpen(s.id);
    await fiscal.zReport(); // queued behind the background open
    expect(vcr.zOpen).toBe(true);
    vcr.failNext('ZReport.Close', 704006);
    await closeSession(
      t.db,
      cashier,
      closeSessionInput.parse({ sessionId: s.id, countedCash: '0', actions: [] }),
    );
    expect(await fiscal.afterShiftClose(s.id)).toContain('Z-hisobot yopilmadi');
  });

  it('getOrder shows the fiscal state', async () => {
    const o = await t.db.order.findFirstOrThrow({ where: { fiscalStatus: 'FISCALIZED' } });
    expect((await getOrder(t.db, o.id)).fiscal).toMatchObject({
      status: 'FISCALIZED',
      terminalId: FAKE_TERMINAL,
    });
  });
});

describe('review fixes (F18)', () => {
  beforeAll(async () => {
    await openSession(t.db, cashier, { items: [{ menuItemId: dish, initialQuantity: '500' }] });
  });

  it('a delete that would be refused never reaches VCR: no refund for a check that stays', async () => {
    const CARA = { phone: '998907778899', name: 'Cara', dueDate: null };
    const paid = await pay(await order(1), { method: 'debt', debtCustomer: CARA });
    const customerId = (await t.db.customer.findUniqueOrThrow({ where: { phone: CARA.phone } })).id;
    await repayDebt(t.db, cashier, { customerId, amount: '10000', method: 'cash', note: null });
    expect(await fiscal.send(paid.id)).toBe('sent');
    const before = vcr.calls.length;
    // Deleting it would leave Cara having repaid more than she owes.
    await expect(assertCheckCancellable(t.db, paid.orderNumber)).rejects.toMatchObject({
      details: { reason: 'DEBT_REPAID' },
    });
    expect(vcr.calls.length).toBe(before);
    expect((await row(paid.id)).fiscalStatus).toBe('FISCALIZED');
    // The dry run changed nothing.
    expect((await row(paid.id)).status).toBe('completed');
  });

  it('a voided repayment after a failed send: the check waits for its debt, nothing is sold', async () => {
    const DAN = { phone: '998901010101', name: 'Dan', dueDate: null };
    const paid = await pay(await order(1), { method: 'debt', debtCustomer: DAN });
    const customerId = (await t.db.customer.findUniqueOrThrow({ where: { phone: DAN.phone } })).id;
    await repayDebt(t.db, cashier, { customerId, amount: '10000', method: 'cash', note: null });
    vcr.failNext('Receipt.Sale', 704002); // no OFD sync: PENDING with an error (attempted)
    expect(await fiscal.send(paid.id)).toBe('pending');
    const last = await t.db.debtRepayment.findFirstOrThrow({ where: { customerId } });
    await voidRepayment(t.db, cashier, { repaymentId: last.id, reason: 'xato' });
    const before = sales().length;
    expect(await fiscal.send(paid.id)).toBe('skipped');
    expect(sales().length).toBe(before);
    expect((await row(paid.id)).fiscalStatus).toBe('DEFERRED_DEBT');
  });

  it('an edited check whose debt was written off still waits', async () => {
    const EVE = { phone: '998902020202', name: 'Eve', dueDate: null };
    const paid = await pay(await order(1), { method: 'debt', debtCustomer: EVE });
    const customerId = (await t.db.customer.findUniqueOrThrow({ where: { phone: EVE.phone } })).id;
    await writeOffDebt(t.db, cashier, { customerId, amount: '10000', note: 'kechirildi' });
    await editCheck(
      t.db,
      cashier,
      editCheckInput.parse({
        orderNumber: paid.orderNumber,
        tenders: [{ method: 'debt', amount: '10000' }],
        debtCustomer: EVE,
      }),
    );
    expect((await row(paid.id)).fiscalStatus).toBe('DEFERRED_DEBT');
  });

  it('a check being changed is not sent meanwhile', async () => {
    const paid = await pay(await order(1));
    const outcome = await fiscal.whileChanging(paid.orderNumber, () => fiscal.send(paid.id));
    expect(outcome).toBe('skipped');
    expect(await fiscal.send(paid.id)).toBe('sent');
  });

  it('a receipt for a check cancelled meanwhile is not recorded as its receipt', async () => {
    const paid = await pay(await order(1));
    await t.db.order.update({ where: { id: paid.id }, data: { status: 'cancelled' } });
    await t.db.order.update({ where: { id: paid.id }, data: { status: 'completed' } });
    // Simulates the race directly: the order leaves `completed` between build and record.
    const errors: string[] = [];
    const racing = new FiscalService({
      getDb: () => t.db,
      cipher: plainCipher,
      urlOverride: vcr.url,
      onChange: () => undefined,
      log: { ...quiet, error: (m: string) => errors.push(m) },
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === 'Receipt.Sale')
          await t.db.order.update({ where: { id: paid.id }, data: { status: 'cancelled' } });
        return fetch(url, init);
      },
    });
    expect(await racing.send(paid.id)).toBe('sent');
    expect((await row(paid.id)).fiscalStatus).toBe('PENDING');
    expect(errors.some((m) => m.includes('no longer a paid check'))).toBe(true);
  });

  it('a stored host the form would refuse is never connected to', async () => {
    const cfg = await fiscal.getConfig();
    await t.db.setting.update({
      where: { key: 'fiscal_vcr_host' },
      data: { value: JSON.stringify('010.8.8.8') },
    });
    const strict = new FiscalService({
      getDb: () => t.db,
      cipher: plainCipher,
      onChange: () => undefined,
      log: quiet,
    });
    await expect(strict.testConnection()).rejects.toMatchObject({
      details: { reason: 'NO_PASSWORD' },
    });
    await fiscal.setConfig({ ...cfg, password: '' });
  });
});
