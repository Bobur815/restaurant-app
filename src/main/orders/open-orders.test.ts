import {
  listChecksInput,
  menuItemInput,
  receiptSettingsInput,
  saveOpenOrderInput,
  saveTableOrderInput,
  salesReportInput,
} from '@shared/schemas';
import type { ReceiptSettingsDto } from '@shared/types';
import { dec } from '@shared/utils/decimal';
import { findCustomerByPhone } from '../customers/customers';
import { dayKey, type Actor } from '../domain/db';
import { createMenuItem } from '../menu/menu-items';
import { listChecks, payOrder } from '../payments/payments';
import { buildReceiptHtml } from '../printing/receipt';
import { salesReport } from '../reports/reports';
import { getOpenSession, openSession } from '../sessions/sessions';
import { updateSettings } from '../settings/settings';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import {
  cancelOpenOrder,
  getOrder,
  listBusyTables,
  listOpenOrders,
  saveOpenOrder,
  saveTableOrder,
  setDeliveryStatus,
} from './orders';

jest.setTimeout(60_000);

let t: TestDb;
let cashier: Actor;
let osh: number; // 25 000, portions
let choy: number; // 3 000
const today = dayKey(new Date());

beforeAll(async () => {
  t = await createTestDb();
  cashier = await createUser(t.db, { username: 'kassir' });
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
  await openSession(t.db, cashier, {
    items: [
      { menuItemId: osh, initialQuantity: '20' },
      { menuItemId: choy, initialQuantity: '50' },
    ],
  });
});
afterAll(() => t.close());

const open = (input: Record<string, unknown>) =>
  saveOpenOrder(t.db, cashier, saveOpenOrderInput.parse(input));
const sold = async (menuItemId: number) =>
  (await getOpenSession(t.db))!.items.find((i) => i.menuItemId === menuItemId)!.soldQuantity;

describe('input rules', () => {
  it('delivery needs a phone and an address; phones are normalized', () => {
    const r = saveOpenOrderInput.safeParse({
      orderType: 'DELIVERY',
      lines: [{ menuItemId: 1, quantity: 1 }],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual([
      'customerPhone',
      'deliveryAddress',
    ]);
    expect(
      saveOpenOrderInput.safeParse({
        orderType: 'TAKEAWAY',
        customerPhone: '+998 (90) 12',
        lines: [{ menuItemId: 1, quantity: 1 }],
      }).success,
    ).toBe(false);
    const ok = saveOpenOrderInput.parse({
      orderType: 'TAKEAWAY',
      customerPhone: '+998 (90) 123-45-67',
      lines: [{ menuItemId: 1, quantity: 1 }],
    });
    expect(ok.customerPhone).toBe('998901234567');
    // The bare mask the input starts with counts as empty.
    expect(
      saveOpenOrderInput.parse({
        orderType: 'TAKEAWAY',
        customerPhone: '+998 (',
        lines: [{ menuItemId: 1, quantity: 1 }],
      }).customerPhone,
    ).toBeNull();
  });
});

describe('takeaway and delivery', () => {
  it('takeaway: no table, no customer needed, stock taken like a table order', async () => {
    const before = await sold(choy);
    const order = await open({ orderType: 'TAKEAWAY', lines: [{ menuItemId: choy, quantity: 2 }] });
    expect(order).toMatchObject({
      orderType: 'TAKEAWAY',
      tableNumber: null,
      totalAmount: '6000',
      deliveryFee: '0',
      deliveryStatus: null,
      customerId: null,
    });
    expect(
      dec(await sold(choy))
        .minus(before)
        .toFixed(),
    ).toBe('2');
  });

  it('any number of takeaway/delivery orders are open at once; tables stay one order each', async () => {
    await open({ orderType: 'TAKEAWAY', lines: [{ menuItemId: choy, quantity: 1 }] });
    await open({ orderType: 'TAKEAWAY', lines: [{ menuItemId: choy, quantity: 1 }] });
    expect((await listOpenOrders(t.db)).length).toBeGreaterThanOrEqual(3);

    const table = await saveTableOrder(
      t.db,
      cashier,
      saveTableOrderInput.parse({ tableNumber: 1, lines: [{ menuItemId: choy, quantity: 1 }] }),
    );
    // The open orders never show as busy tables, and table 1 is still guarded by its trigger.
    expect((await listBusyTables(t.db)).map((b) => b.tableNumber)).toEqual([1]);
    await expect(
      t.db.order.create({
        data: { orderNumber: 'X-1', tableNumber: 1, sessionId: table.sessionId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('delivery: fee in the total, customer created and remembered, PREPARING', async () => {
    const order = await open({
      orderType: 'DELIVERY',
      customerPhone: '90 123 45 67',
      customerName: 'Aziza',
      deliveryAddress: 'Chilonzor 9-kvartal, 12-uy',
      deliveryNote: 'Korzinka yonida',
      deliveryFee: '10000',
      lines: [
        { menuItemId: osh, quantity: 1 },
        { menuItemId: osh, quantity: 1, portion: '0.7' },
      ],
    });
    // 25 000 + 17 500 + 10 000
    expect(order).toMatchObject({
      orderType: 'DELIVERY',
      tableNumber: null,
      totalAmount: '52500',
      deliveryFee: '10000',
      deliveryStatus: 'PREPARING',
      customerPhone: '998901234567',
      customerName: 'Aziza',
    });
    expect(await findCustomerByPhone(t.db, '+998 (90) 123-45-67')).toMatchObject({
      name: 'Aziza',
      address: 'Chilonzor 9-kvartal, 12-uy',
      landmark: 'Korzinka yonida',
    });
  });

  it('a later order updates what it gives and never erases what it leaves out', async () => {
    await open({
      orderType: 'DELIVERY',
      customerPhone: '998901234567',
      deliveryAddress: 'Yunusobod 4',
      lines: [{ menuItemId: choy, quantity: 1 }],
    });
    expect(await findCustomerByPhone(t.db, '901234567')).toMatchObject({
      name: 'Aziza',
      address: 'Yunusobod 4',
      landmark: 'Korzinka yonida',
    });
    expect(await findCustomerByPhone(t.db, '90 999 99 99')).toBeNull();
    expect(await findCustomerByPhone(t.db, '90 12')).toBeNull();
  });

  it('edits need the version seen; the snapshot follows the edit, the fee only for delivery', async () => {
    const choyBefore = await sold(choy);
    const order = await open({
      orderType: 'DELIVERY',
      customerPhone: '+998 93 000 00 01',
      deliveryAddress: 'Sergeli',
      deliveryFee: '5000',
      lines: [{ menuItemId: choy, quantity: 1 }],
    });
    await expect(
      open({
        orderId: order.id,
        orderType: 'DELIVERY',
        customerPhone: '+998 93 000 00 01',
        deliveryAddress: 'Sergeli',
        lines: [{ menuItemId: choy, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'STALE' } });

    // Switched to takeaway on the phone: no fee, no address, no delivery status.
    const edited = await open({
      orderId: order.id,
      expectedVersion: order.version,
      orderType: 'TAKEAWAY',
      customerPhone: '+998 93 000 00 01',
      deliveryAddress: 'Sergeli',
      deliveryFee: '5000',
      lines: [{ menuItemId: choy, quantity: 3 }],
    });
    // Old line (1) given back, new one (3) taken once: +3 since before the order.
    expect(
      dec(await sold(choy))
        .minus(choyBefore)
        .toFixed(),
    ).toBe('3');
    expect(edited).toMatchObject({
      orderType: 'TAKEAWAY',
      totalAmount: '9000',
      deliveryFee: '0',
      deliveryAddress: null,
      deliveryStatus: null,
      version: order.version + 1,
    });
  });

  it('cancel gives the stock back; table orders are not reachable through these channels', async () => {
    const before = await sold(osh);
    const order = await open({ orderType: 'TAKEAWAY', lines: [{ menuItemId: osh, quantity: 2 }] });
    expect(
      dec(await sold(osh))
        .minus(before)
        .toFixed(),
    ).toBe('2');
    const cancelled = await cancelOpenOrder(t.db, {
      orderId: order.id,
      expectedVersion: order.version,
    });
    expect(cancelled.status).toBe('cancelled');
    expect(await sold(osh)).toBe(before);
    expect((await listOpenOrders(t.db)).map((o) => o.orderId)).not.toContain(order.id);

    const table = (await listBusyTables(t.db))[0]!;
    await expect(cancelOpenOrder(t.db, { orderId: table.orderId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('delivery status and courier; paying a delivery marks it delivered', async () => {
    const order = await open({
      orderType: 'DELIVERY',
      customerPhone: '+998 97 111 22 33',
      deliveryAddress: 'Olmazor',
      lines: [{ menuItemId: choy, quantity: 1 }],
    });
    const onTheWay = await setDeliveryStatus(t.db, {
      orderId: order.id,
      status: 'ON_THE_WAY',
      courierName: 'Bekzod',
      expectedVersion: order.version,
    });
    expect(onTheWay).toMatchObject({ deliveryStatus: 'ON_THE_WAY', courierName: 'Bekzod' });
    await expect(
      setDeliveryStatus(t.db, { orderId: order.id, status: 'PREPARING', expectedVersion: 0 }),
    ).rejects.toMatchObject({ details: { reason: 'STALE' } });

    const paid = await payOrder(t.db, cashier, { orderId: order.id, method: 'cash' });
    expect(paid).toMatchObject({ status: 'completed', deliveryStatus: 'DELIVERED' });
    await expect(
      setDeliveryStatus(t.db, { orderId: order.id, status: 'ON_THE_WAY' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a switched-off order type refuses new orders but lets open ones finish', async () => {
    const order = await open({ orderType: 'TAKEAWAY', lines: [{ menuItemId: choy, quantity: 1 }] });
    await updateSettings(t.db, { takeawayEnabled: false });
    await expect(
      open({ orderType: 'TAKEAWAY', lines: [{ menuItemId: choy, quantity: 1 }] }),
    ).rejects.toMatchObject({ details: { reason: 'TYPE_DISABLED' } });
    const edited = await open({
      orderId: order.id,
      expectedVersion: order.version,
      orderType: 'TAKEAWAY',
      lines: [{ menuItemId: choy, quantity: 2 }],
    });
    expect(edited.totalAmount).toBe('6000');
    await updateSettings(t.db, { takeawayEnabled: true });
  });
});

describe('receipt, checks and reports', () => {
  const settings = (): ReceiptSettingsDto => ({
    ...receiptSettingsInput.parse({ restaurantName: 'Shoxona' }),
    extraPhones: '',
    logoPath: null,
  });

  it('the delivery receipt shows the type, customer, address and fee, not a table', async () => {
    const order = await open({
      orderType: 'DELIVERY',
      customerPhone: '+998 90 555 66 77',
      customerName: '<b>Ali</b>',
      deliveryAddress: 'Mirobod 3',
      deliveryNote: 'Masjid yonida',
      deliveryFee: '8000',
      lines: [{ menuItemId: choy, quantity: 1 }],
    });
    const html = buildReceiptHtml(await getOrder(t.db, order.id), settings());
    expect(html).toContain('<b>Yetkazib berish</b>');
    expect(html).not.toContain('Stol:');
    expect(html).toContain('&lt;b&gt;Ali&lt;/b&gt;');
    expect(html).toContain('+998 90 555 66 77');
    expect(html).toContain('Mirobod 3');
    expect(html).toContain('Masjid yonida');
    expect(html).toMatch(/Yetkazib berish xizmati<\/span><span class="amount">8\s000/);
    await payOrder(t.db, cashier, { orderId: order.id, method: 'card' });
  });

  it('checks carry the order type and filter by it; reports split payments by type', async () => {
    const takeaway = (await listOpenOrders(t.db)).find((o) => o.orderType === 'TAKEAWAY')!;
    await payOrder(t.db, cashier, { orderId: takeaway.orderId, method: 'cash' });

    const deliveries = await listChecks(
      t.db,
      listChecksInput.parse({ startDate: today, endDate: today, orderType: 'DELIVERY' }),
    );
    expect(deliveries.length).toBe(2);
    expect(deliveries.every((c) => c.orderType === 'DELIVERY' && c.tableNumber === null)).toBe(
      true,
    );

    const day = (await salesReport(t.db, salesReportInput.parse({ start: today, end: today })))
      .daily[0]!;
    // Delivery: 3 000 (Olmazor) + 3 000 + 8 000 fee (Mirobod); takeaway: the one paid above.
    expect(day.delivery).toBe('14000');
    expect(day.deliveryFees).toBe('8000');
    expect(day.takeaway).toBe(takeaway.totalAmount);
    expect(day.dineIn).toBe('0');
    expect(day.total).toBe(dec('14000').plus(takeaway.totalAmount).toFixed());
  });
});

describe('review fixes (F1-B)', () => {
  it('fee: default from settings on create, kept when an edit leaves it out, rounded once', async () => {
    await updateSettings(t.db, { deliveryFeeDefault: '12000' });
    const created = await open({
      orderType: 'DELIVERY',
      customerPhone: '+998 91 000 00 01',
      deliveryAddress: 'Yakkasaroy',
      lines: [{ menuItemId: osh, quantity: 1, portion: '0.7' }],
    });
    // 17 500 (0.7 portion) + 12 000 default fee
    expect(created).toMatchObject({ deliveryFee: '12000', totalAmount: '29500' });

    const edited = await open({
      orderId: created.id,
      expectedVersion: created.version,
      orderType: 'DELIVERY',
      customerPhone: '+998 91 000 00 01',
      deliveryAddress: 'Yakkasaroy',
      lines: [{ menuItemId: osh, quantity: 2, portion: '0.7' }],
    });
    expect(edited).toMatchObject({ deliveryFee: '12000', totalAmount: '47000' });

    const changed = await open({
      orderId: edited.id,
      expectedVersion: edited.version,
      orderType: 'DELIVERY',
      customerPhone: '+998 91 000 00 01',
      deliveryAddress: 'Yakkasaroy',
      deliveryFee: '7500.5',
      lines: [{ menuItemId: osh, quantity: 2, portion: '0.7' }],
    });
    expect(changed).toMatchObject({ deliveryFee: '7500.5', totalAmount: '42500.5' });
    expect(dec(changed.totalAmount).minus(changed.deliveryFee).toFixed()).toBe('35000');
    await cancelOpenOrder(t.db, { orderId: changed.id, expectedVersion: changed.version });
    await updateSettings(t.db, { deliveryFeeDefault: '0' });
  });

  it('fee input: at most 2 decimals and 10 000 000', () => {
    const base = { orderType: 'TAKEAWAY', lines: [{ menuItemId: 1, quantity: 1 }] };
    expect(saveOpenOrderInput.safeParse({ ...base, deliveryFee: '1000.555' }).success).toBe(false);
    expect(saveOpenOrderInput.safeParse({ ...base, deliveryFee: '10000001' }).success).toBe(false);
    expect(
      saveOpenOrderInput.safeParse({ ...base, deliveryFee: '1'.padEnd(40, '0') }).success,
    ).toBe(false);
    expect(saveOpenOrderInput.safeParse({ ...base, deliveryFee: '10000000' }).success).toBe(true);
    expect(saveOpenOrderInput.safeParse({ ...base, deliveryFee: '0015000.50' }).success).toBe(true);
  });

  it('an open order cannot switch into a type that is switched off', async () => {
    const order = await open({ orderType: 'TAKEAWAY', lines: [{ menuItemId: choy, quantity: 1 }] });
    await updateSettings(t.db, { deliveryEnabled: false });
    await expect(
      open({
        orderId: order.id,
        expectedVersion: order.version,
        orderType: 'DELIVERY',
        customerPhone: '+998 91 000 00 02',
        deliveryAddress: 'Uchtepa',
        lines: [{ menuItemId: choy, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ details: { reason: 'TYPE_DISABLED' } });
    await updateSettings(t.db, { deliveryEnabled: true });
    await cancelOpenOrder(t.db, { orderId: order.id, expectedVersion: order.version });
  });

  it('the phone lookup gives only name, address and landmark', async () => {
    expect(await findCustomerByPhone(t.db, '+998 90 123 45 67')).toEqual({
      name: 'Aziza',
      address: 'Yunusobod 4',
      landmark: 'Korzinka yonida',
    });
    // A mistyped (too long) number finds nobody instead of being cut to a match.
    expect(await findCustomerByPhone(t.db, '+998 90 123 45 67 1')).toBeNull();
  });

  it('a takeaway remark prints as a remark, not a landmark', async () => {
    const order = await open({
      orderType: 'TAKEAWAY',
      deliveryNote: 'Tayyor bo`lsa qo`ng`iroq qiling',
      lines: [{ menuItemId: choy, quantity: 1 }],
    });
    const html = buildReceiptHtml(order, {
      ...receiptSettingsInput.parse({ restaurantName: 'Shoxona' }),
      extraPhones: '',
      logoPath: null,
    });
    expect(html).toContain('<b>Izoh:</b>');
    expect(html).not.toContain("Mo'ljal");
    await cancelOpenOrder(t.db, { orderId: order.id, expectedVersion: order.version });
  });
});
