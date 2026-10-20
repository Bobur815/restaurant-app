jest.mock('electron', () => ({ BrowserWindow: class {} }));

import { menuItemInput, receiptSettingsInput, saveTableOrderInput } from '@shared/schemas';
import type { OrderDto, ReceiptSettingsDto } from '@shared/types';
import { createMenuItem } from '../menu/menu-items';
import { saveTableOrder } from '../orders/orders';
import { payOrder } from '../payments/payments';
import { openSession } from '../sessions/sessions';
import { completeSetup } from '../settings/setup';
import { toCurrentUser } from '../auth/auth';
import { createTestDb, type TestDb } from '../test-utils/db';
import { pickPrinter, receiptWindowOptions, type PrinterService } from './printer';
import { legacyLayout, updateReceiptLayout } from './layouts';
import { previewReceipt, printOrderReceipt, printTestReceipt } from './printing';
import { buildReceiptHtml, sampleOrder } from './receipt';

jest.setTimeout(60_000);

const settings = (over: Partial<ReceiptSettingsDto> = {}): ReceiptSettingsDto => ({
  restaurantName: 'Shoxona',
  address: 'Arabmozor',
  phone: '+998 90 000 00 00',
  extraPhones: '',
  footerNote: 'Rahmat!',
  locale: 'uz',
  currency: 'UZS',
  logoPath: null,
  printerName: null,
  printWidthPx: 420,
  printUseStarsSep: true,
  printSeparatorChar: '*',
  printSeparatorCount: 10,
  printShowAddress: true,
  printShowPhone: true,
  printShowDateTime: true,
  printShowOrderNumber: true,
  ...over,
});

/** A 1x1 PNG, as the image store would hand it out. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TOP = `${'a'.repeat(32)}.png`;
const BOTTOM = `${'b'.repeat(32)}.png`;
const noImages = () => null;

describe('receipt HTML', () => {
  const order = sampleOrder('uz');

  it('contains the shop, the order, every line and the total, money formatted', () => {
    const html = buildReceiptHtml(order, settings(), { printedAt: new Date(2026, 9, 19, 14, 5) });
    expect(html).toContain('<h1 class="brand">Shoxona</h1>');
    expect(html).toContain('Arabmozor');
    expect(html).toContain(`#${order.orderNumber}`);
    expect(html).toContain('19.10.2026');
    expect(html).toContain('14:05');
    expect(html).toContain('3. Shashlik (0,25');
    expect(html).toContain('2. Osh (70%)');
    expect(html).toMatch(/129\s600\sso&#39;m/);
    expect(html).toContain('Naqd');
    expect(html).toContain('**********');
    expect(html).toContain('Rahmat!');
  });

  it('escapes every value from the database', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = buildReceiptHtml(
      { ...order, lines: [{ ...order.lines[0]!, nameUz: evil }] } as OrderDto,
      settings({
        restaurantName: `${evil}"`,
        address: evil,
        footerNote: '</style><script>x()</script>',
        printSeparatorChar: '<',
      }),
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // The document forbids scripts even if markup ever slipped through.
    expect(html).toContain(
      `content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"`,
    );
  });

  it('honours the layout switches and the receipt language', () => {
    const html = buildReceiptHtml(
      sampleOrder('ru'),
      settings({
        locale: 'ru',
        printShowAddress: false,
        printShowPhone: false,
        printShowDateTime: false,
        printShowOrderNumber: false,
        printUseStarsSep: false,
        footerNote: '',
      }),
    );
    expect(html).not.toContain('Arabmozor');
    expect(html).not.toContain('+998');
    expect(html).not.toContain('Дата');
    expect(html).not.toContain('Заказ:');
    expect(html).not.toContain('****');
    expect(html).toContain('Плов');
    expect(html).toContain('Итого к оплате');
    expect(html).toContain('сум');
  });

  it('each order type has its own switches, customer block and footer', () => {
    const delivery = sampleOrder('uz', 'DELIVERY');
    const base = { ...legacyLayout(settings()), orderType: 'DELIVERY' as const };
    const full = buildReceiptHtml(delivery, settings(), {
      layout: { ...base, footerNote: 'Yoqimli ishtaha!' },
    });
    expect(full).toContain('Yetkazib berish');
    expect(full).toContain('Aziza');
    expect(full).toContain('Chilonzor 9');
    expect(full).toMatch(/10\s000/); // the delivery fee
    expect(full).toContain('Yoqimli ishtaha!');
    expect(full).not.toContain('Rahmat!'); // the shared settings' old footer is not used

    const bare = buildReceiptHtml(delivery, settings(), {
      layout: { ...base, showCustomer: false, showAddress: false, footerNote: '' },
    });
    expect(bare).not.toContain('Aziza');
    expect(bare).not.toContain('Arabmozor');
    expect(bare).not.toContain('class="footer"');
  });

  it('puts the top and bottom pictures at their width, and prints on without a missing one', () => {
    const layout = {
      ...legacyLayout(settings()),
      topImage: TOP,
      topImageWidth: 70,
      bottomImage: BOTTOM,
      bottomImageWidth: 35,
    };
    const html = buildReceiptHtml(order, settings(), {
      layout,
      image: (name) => (name === TOP || name === BOTTOM ? PNG : null),
    });
    const top = html.indexOf('class="picture picture-top"');
    const bottom = html.indexOf('class="picture picture-bottom"');
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(html.indexOf('class="brand"'));
    expect(bottom).toBeGreaterThan(html.indexOf('class="total"'));
    expect(html).toContain('style="width: 70%"');
    expect(html).toContain('style="width: 35%"');

    // A file gone from the store, or anything that is not an image, is left out.
    const missing = buildReceiptHtml(order, settings(), {
      layout,
      image: (name) => (name === TOP ? 'javascript:alert(1)' : null),
    });
    expect(missing).not.toContain('<img');
    expect(missing).toContain('class="brand"');
  });

  it('sample orders follow the order type', () => {
    expect(sampleOrder('uz', 'TAKEAWAY')).toMatchObject({
      orderType: 'TAKEAWAY',
      tableNumber: null,
      customerName: 'Aziz',
    });
    expect(sampleOrder('uz', 'DELIVERY')).toMatchObject({
      deliveryFee: '10000',
      totalAmount: '139600',
    });
  });
});

describe('printer choice', () => {
  const p = (name: string, isDefault = false) => ({ name, isDefault });

  it('uses the configured printer, matched loosely', () => {
    const list = [p('Microsoft Print to PDF', true), p('XP-80C (copy 1)')];
    expect(pickPrinter(list, 'XP-80C (copy 1)')).toBe('XP-80C (copy 1)');
    expect(pickPrinter(list, 'xp 80c')).toBe('XP-80C (copy 1)');
  });

  it('otherwise finds the thermal printer, never a virtual one', () => {
    expect(
      pickPrinter(
        [p('Microsoft XPS Document Writer', true), p('OneNote'), p('XP-80 on USB001')],
        null,
      ),
    ).toBe('XP-80 on USB001');
    expect(pickPrinter([p('Fax'), p('HP LaserJet', true)], 'Missing printer')).toBe('HP LaserJet');
    expect(pickPrinter([p('Canon'), p('HP')], null)).toBe('Canon');
    expect(pickPrinter([], 'XP-80')).toBeNull();
  });
});

describe('print window', () => {
  it('is sandboxed, isolated, without preload or node', () => {
    const o = receiptWindowOptions();
    expect(o.show).toBe(false);
    expect(o.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(o.webPreferences).not.toHaveProperty('preload');
  });
});

describe('printing from the database', () => {
  let t: TestDb;
  const printed: Array<{ html: string; preferredName: string | null }> = [];
  const fakePrinter: PrinterService = {
    list: async () => [],
    print: async (html, opts) => {
      printed.push({ html, ...opts });
      return { printer: 'XP-80' };
    },
    preview: async (html) => `data:text/html,${encodeURIComponent(html)}`,
  };

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it('refuses until receipt settings exist', async () => {
    await expect(printTestReceipt(t.db, fakePrinter, 'DINE_IN', noImages)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('prints the order from the database with the configured printer', async () => {
    const { user: admin } = await completeSetup(t.db, {
      admin: { fullName: 'Boss', phone: '998900000001', pin: '1234' },
      receipt: receiptSettingsInput.parse({
        restaurantName: 'Shoxona',
        address: 'Arabmozor',
        printerName: 'XP-80C',
        printWidthPx: 380,
      }),
      tableCount: 10,
    });
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    const dish = await createMenuItem(
      t.db,
      menuItemInput.parse({ nameUz: '<b>Non</b>', price: '5000', categoryId }),
    );
    await openSession(t.db, admin, { items: [{ menuItemId: dish.id, initialQuantity: '10' }] });
    const order = await saveTableOrder(
      t.db,
      admin,
      saveTableOrderInput.parse({ tableNumber: 2, lines: [{ menuItemId: dish.id, quantity: 3 }] }),
    );
    await payOrder(t.db, admin, { orderId: order.id, method: 'card' });

    expect(await printOrderReceipt(t.db, fakePrinter, order.id, noImages)).toEqual({
      printer: 'XP-80',
    });
    const job = printed.at(-1)!;
    expect(job).toMatchObject({ preferredName: 'XP-80C' });
    // Laid out at the paper's printable width, whatever the old pixel setting says.
    expect(job.html).toContain('width: 72.1mm');
    expect(job.html).not.toContain('380px');
    expect(job.html).toContain('&lt;b&gt;Non&lt;/b&gt;');
    expect(job.html).toMatch(/15\s000/);
    expect(job.html).toContain('Karta');
  });

  it("prints with the layout of the order's type, pictures from the store", async () => {
    const order = await t.db.order.findFirstOrThrow({ where: { status: 'completed' } });
    await updateReceiptLayout(t.db, { orderType: 'DINE_IN', footerNote: 'Stol uchun' });
    await updateReceiptLayout(t.db, {
      orderType: 'DELIVERY',
      footerNote: 'Yetkazib berdik',
      topImage: TOP,
    });
    const image = (name: string) => (name === TOP ? PNG : null);

    await printOrderReceipt(t.db, fakePrinter, order.id, image);
    expect(printed.at(-1)!.html).toContain('Stol uchun');
    expect(printed.at(-1)!.html).not.toContain('<img');

    await t.db.order.update({ where: { id: order.id }, data: { orderType: 'DELIVERY' } });
    await printOrderReceipt(t.db, fakePrinter, order.id, image);
    expect(printed.at(-1)!.html).toContain('Yetkazib berdik');
    expect(printed.at(-1)!.html).toContain(PNG);
    await t.db.order.update({ where: { id: order.id }, data: { orderType: 'DINE_IN' } });

    await printTestReceipt(t.db, fakePrinter, 'DELIVERY', image);
    expect(printed.at(-1)!.html).toContain('Aziza');
    expect(printed.at(-1)!.html).toContain('Yetkazib berdik');
  });

  it('refuses a cancelled order', async () => {
    const actor = toCurrentUser(await t.db.user.findFirstOrThrow());
    const dish = await t.db.menuItem.findFirstOrThrow();
    const order = await saveTableOrder(
      t.db,
      actor,
      saveTableOrderInput.parse({ tableNumber: 5, lines: [{ menuItemId: dish.id, quantity: 1 }] }),
    );
    await t.db.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    await expect(printOrderReceipt(t.db, fakePrinter, order.id, noImages)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('preview applies unsaved form values over the saved settings and layout', async () => {
    const url = await previewReceipt(
      t.db,
      fakePrinter,
      {
        orderType: 'TAKEAWAY',
        receipt: { restaurantName: 'Yangi nom', locale: 'ru' },
        layout: { footerNote: 'Saqlanmagan izoh', bottomImage: BOTTOM },
      },
      (name) => (name === BOTTOM ? PNG : null),
    );
    const html = decodeURIComponent(url.replace('data:text/html,', ''));
    expect(html).toContain('Yangi nom');
    expect(html).toContain('Итого к оплате');
    expect(html).toContain('С собой');
    expect(html).toContain('Saqlanmagan izoh');
    expect(html).toContain('class="picture picture-bottom"');
    // Nothing was saved.
    expect(await t.db.receiptLayout.findUnique({ where: { orderType: 'TAKEAWAY' } })).toBeNull();
  });
});
