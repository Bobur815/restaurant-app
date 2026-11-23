import type { IpcChannel } from '@shared/ipc';
import { localDate, receiptSettingsInput } from '@shared/schemas';
import { newRecoveryCode } from '../auth/auth';
import type { Actor } from '../domain/db';
import { RECEIPT_SETTINGS_ID } from '../settings/settings';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { unsupportedUpdater } from '../test-utils/updater';
import { allowAllLicense } from '../test-utils/license';
import { READ_ONLY_CHANNELS } from './events';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext } from './ipc-safe';
import { plainCipher } from '../lan/config';
import { hashSecret } from '../lan/pairing';
import { LanService } from '../lan/lan-service';
import { TableLocks } from '../orders/table-locks';
import { FiscalService } from '../fiscal/fiscal-service';
import { saveFiscalConfig } from '../fiscal/config';
import { startFakeVcr, type FakeVcr } from '../test-utils/fake-vcr';

jest.setTimeout(60_000);

/**
 * Phase 6 audit: no response, on any channel, ever carries a password or PIN hash. Users here
 * have both set, and the database has a shift, an order and a payment, so the read channels
 * return real rows (users, orders with createdBy, checks...).
 */
// bcrypt hashes, the 64-hex PIN HMACs, and the secret column names.
// F18: the VCR cassir password (and its base64 auth form) never leaves main either.
const VCR_PASSWORD = 'vcr-pass-9876';
const VCR_AUTH = Buffer.from(`cassir:${VCR_PASSWORD}`).toString('base64');
const SECRET = new RegExp(
  /\$2[aby]\$\d\d\$|[0-9a-f]{64}|pinHash|legacyPinCode|pin_key|recovery_hash/.source +
    `|${VCR_PASSWORD}|${VCR_AUTH}`,
);

let t: TestDb;
let admin: Actor;
let vcr: FakeVcr;
let fiscal: FiscalService;

beforeAll(async () => {
  t = await createTestDb();
  admin = await createUser(t.db, { username: 'boss', role: 'ADMIN', pin: '1234' });
  const staff = await createUser(t.db, { username: 'kassa', pin: '4321' });
  await newRecoveryCode(t.db);

  // Receipt settings, so the printing channels run their whole path (with the fake printer).
  await t.db.receiptSettings.create({
    data: { id: RECEIPT_SETTINGS_ID, ...receiptSettingsInput.parse({ restaurantName: 'Test' }) },
  });

  await t.db.customer.create({
    data: { phone: '998901234567', name: 'Mijoz', address: 'Chilonzor' },
  });

  const category = await t.db.category.findFirstOrThrow();
  const dish = await t.db.menuItem.create({
    data: { nameUz: 'Non', price: '5000', categoryId: category.id },
  });
  const session = await t.db.session.create({
    data: { openedById: admin.id, items: { create: { menuItemId: dish.id, initialQuantity: 10 } } },
  });
  await t.db.order.create({
    data: {
      orderNumber: '2026-00001',
      tableNumber: 1,
      sessionId: session.id,
      createdById: staff.id,
      status: 'completed',
      totalAmount: '5000',
      items: {
        create: {
          menuItemId: dish.id,
          quantity: 1,
          unitPrice: '5000',
          totalPrice: '5000',
          stockQuantity: 1,
        },
      },
      payments: { create: { amount: '5000', method: 'cash', createdById: staff.id } },
    },
  });
  // An unpaid delivery with a customer, so the open-order channels return real rows.
  const customer = await t.db.customer.findUniqueOrThrow({ where: { phone: '998901234567' } });
  await t.db.order.create({
    data: {
      orderNumber: '2026-00002',
      tableNumber: 0,
      orderType: 'DELIVERY',
      sessionId: session.id,
      createdById: staff.id,
      customerId: customer.id,
      customerName: 'Mijoz',
      customerPhone: customer.phone,
      deliveryAddress: 'Chilonzor',
      deliveryStatus: 'PREPARING',
      totalAmount: '5000',
    },
  });

  // Debt: the customer owes on order 1, repaid once (by staff) and once voided (by the admin);
  // and an imported debt without a customer. The debt channels then return real rows.
  await t.db.payment.create({
    data: {
      orderId: 1,
      amount: '20000',
      method: 'debt',
      status: 'pending',
      customerId: customer.id,
      createdById: staff.id,
    },
  });
  await t.db.debtRepayment.create({
    data: { customerId: customer.id, amount: '5000', method: 'cash', createdById: staff.id },
  });
  await t.db.debtRepayment.create({
    data: {
      customerId: customer.id,
      amount: '1000',
      method: 'card',
      createdById: staff.id,
      voidedAt: new Date(),
      voidedById: admin.id,
      voidReason: 'Xato',
    },
  });
  await t.db.payment.create({
    data: { orderId: 1, amount: '3000', method: 'debt', status: 'pending' },
  });
  // A drawer movement by staff (feature F6): the cash summary names who made it.
  await t.db.cashMovement.create({
    data: { sessionId: session.id, type: 'PAY_IN', amount: '10000', createdById: staff.id },
  });
  // A paired satellite (feature F12): lan:status lists it, never its secret's hash.
  await t.db.lanDevice.create({
    data: { name: 'Kassa-2', secretHash: hashSecret('s'.repeat(64)) },
  });
  // A kitchen ticket that did not print (feature F11), so kitchen:failed returns a real row.
  await t.db.kitchenTicket.create({
    data: {
      orderId: 1,
      printerId: 1,
      kind: 'NEW',
      payload: '{}',
      createdById: staff.id,
      error: 'offline',
    },
  });
  // Fiscal receipts on against a fake VCR (F18); order 1 is fiscalised, so duplicate runs.
  vcr = await startFakeVcr({ password: VCR_PASSWORD });
  await saveFiscalConfig(t.db, plainCipher, {
    enabled: true,
    host: '127.0.0.1',
    port: 22298,
    login: 'cassir',
    password: VCR_PASSWORD,
    vatMode: 'nonPayer',
    defaultMxik: '10202001001000000',
    defaultPackage: '',
    serviceMxik: '',
    servicePackage: '',
    deliveryMxik: '',
    deliveryPackage: '',
  });
  vcr.receipts.push({
    Id: 'uuid-1',
    Code: 'x',
    Amount: 500000,
    QRCodeURL: 'https://ofd.soliq.uz/check?t=T&r=1&c=20261111100000&s=1',
    TerminalID: 'T',
    ReceiptNo: '1',
    DateTime: '',
    FiscalSign: '1',
    refunded: false,
    params: null,
  });
  await t.db.order.update({
    where: { id: 1 },
    data: { fiscalStatus: 'FISCALIZED', fiscalReceiptId: 'uuid-1', fiscalSign: '1' },
  });
  fiscal = new FiscalService({
    getDb: () => t.db,
    cipher: plainCipher,
    urlOverride: vcr.url,
    onChange: () => undefined,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
});
afterAll(async () => {
  await vcr.close();
  await t.close();
});

// The till's local date (UTC differs between midnight and 05:00 in Tashkent).
const today = localDate();
const INPUTS: Partial<Record<IpcChannel, unknown>> = {
  'halls:list': { includeInactive: true },
  'printing:printReceipt': { orderId: 1 },
  // The unpaid delivery: a pre-bill is only for a pending order.
  'printing:printPreBill': { orderId: 2 },
  // The main printer row from migration 0015 (a sample ticket, feature F11).
  'printing:testPrinter': { printerId: 1 },
  'orders:get': { id: 1 },
  'debts:get': { customerId: 1 },
  'customers:findByPhone': { phone: '+998 90 123 45 67' },
  'residuals:list': {},
  'expenses:list': {},
  'menu:get': { id: 1 },
  'sessions:get': { id: 1 },
  'sessions:cashSummary': { id: 1 },
  'printing:shiftReport': { sessionId: 1, kind: 'X' },
  'orders:getTable': { tableNumber: 1 },
  'orders:getByNumber': { orderNumber: '2026-00001' },
  'checks:list': { startDate: today, endDate: today },
  'reports:sales': { start: today, end: today },
  'reports:staff': { start: today, end: today },
  'license:signupStart': { phone: '+998 90 123 45 67' },
  'license:signupStatus': { verificationId: 'v1' },
  'fiscal:duplicate': { orderId: 1 },
};

/** Feature F12: the main till's LAN side, not started (no server needed to read its status). */
let lan: LanService;

function ctx(actor: Actor | null): HandlerContext {
  lan ??= new LanService({
    getDb: () => t.db,
    version: '0.0.0',
    imageDir: '',
    machineName: 'test',
    cipher: plainCipher,
    services: () => ctx(null).services,
    deviceLimit: () => null,
    waiterLimit: () => 5,
    broadcastLocal: () => undefined,
    restart: () => undefined,
    log: () => undefined,
  });
  return {
    db: t.db,
    actor,
    setActor: () => undefined,
    terminal: 'test',
    services: {
      appInfo: () => ({ name: 'x', version: '0', isPackaged: false }),
      printer: {
        list: async () => [],
        print: async () => ({ printer: 'Test' }),
        preview: async () => 'data:image/png;base64,',
      },
      pickImage: async () => null,
      receiptImage: () => null,
      tableLocks: new TableLocks(),
      updater: unsupportedUpdater(),
      license: allowAllLicense(),
      lan,
      fiscal,
    },
    log: () => undefined,
  };
}

describe('no secrets over IPC', () => {
  it.each([...READ_ONLY_CHANNELS])('%s', async (channel) => {
    const result = await invokeHandler(
      channel,
      HANDLERS[channel] as never,
      ctx(admin),
      // No entry: no input (channels without input reject `{}`; object schemas default it).
      INPUTS[channel],
    );
    expect(JSON.stringify(result)).not.toMatch(SECRET);
    // A failed call proves nothing about secrets: every read channel must really run here.
    expect(result).toMatchObject({ ok: true });
  });

  it('the staff report really lists a user (F17), with no hash in it', async () => {
    const result = await invokeHandler(
      'reports:staff',
      HANDLERS['reports:staff'] as never,
      ctx(admin),
      INPUTS['reports:staff'],
    );
    expect(result).toMatchObject({ ok: true, data: { rows: [expect.anything()] } });
    expect(JSON.stringify(result)).not.toMatch(SECRET);
  });

  it('PIN login and user management answers carry no hash, key or recovery code', async () => {
    const calls: Array<[IpcChannel, unknown]> = [
      ['auth:pinLogin', { pin: '1234' }],
      ['users:list', undefined],
      ['users:create', { fullName: 'Yangi', phone: '+998 91 111 11 11', pin: '5555' }],
      ['users:update', { id: 2, pin: '6666', permissions: ['orders', 'payments'] }],
      ['auth:recoveryStatus', undefined],
      ['users:updateProfile', { fullName: 'Boss' }],
      ['debts:repay', { customerId: 1, amount: '1000', method: 'cash' }],
      ['debts:void', { repaymentId: 1, reason: 'Tekshiruv' }],
      ['debts:list', { includeSettled: true }],
      ['debts:get', { customerId: null }],
      ['sessions:addCashMovement', { type: 'PAY_IN', amount: '1000', note: 'x' }],
      // F18: saving the fiscal settings answers with them, never with the password.
      [
        'fiscal:setConfig',
        {
          enabled: true,
          host: '127.0.0.1',
          port: 22298,
          login: 'cassir',
          password: VCR_PASSWORD,
          vatMode: 'nonPayer',
          defaultMxik: '10202001001000000',
          defaultPackage: '',
          serviceMxik: '',
          servicePackage: '',
          deliveryMxik: '',
          deliveryPackage: '',
        },
      ],
    ];
    for (const [channel, input] of calls) {
      const result = await invokeHandler(channel, HANDLERS[channel] as never, ctx(admin), input);
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(SECRET);
    }
  });

  it('a check that the pattern does catch a hash (guards the test itself)', () => {
    expect(JSON.stringify({ a: '$2a$10$abcdefghijklmnopqrstuv' })).toMatch(SECRET);
  });
});
