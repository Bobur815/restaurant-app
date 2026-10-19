jest.mock('electron', () => ({ BrowserWindow: class {} }));

import { menuItemInput, receiptSettingsInput, saveTableOrderInput } from '@shared/schemas';
import type { OrderDto, ReceiptSettingsDto } from '@shared/types';
import { createMenuItem } from '../menu/menu-items';
import { saveTableOrder } from '../orders/orders';
import { payOrder } from '../payments/payments';
import { openSession } from '../sessions/sessions';
import { completeSetup } from '../settings/setup';
import { createTestDb, type TestDb } from '../test-utils/db';
import { pickPrinter, receiptWindowOptions, type PrinterService } from './printer';
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
    const o = receiptWindowOptions(420);
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
  const printed: Array<{ html: string; preferredName: string | null; widthPx: number }> = [];
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
    await expect(printTestReceipt(t.db, fakePrinter)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('prints the order from the database with the configured printer and width', async () => {
    const admin = await completeSetup(t.db, {
      admin: { username: 'boss', password: 'boss-pass', fullName: null },
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

    expect(await printOrderReceipt(t.db, fakePrinter, order.id)).toEqual({ printer: 'XP-80' });
    const job = printed.at(-1)!;
    expect(job).toMatchObject({ preferredName: 'XP-80C', widthPx: 380 });
    expect(job.html).toContain('&lt;b&gt;Non&lt;/b&gt;');
    expect(job.html).toMatch(/15\s000/);
    expect(job.html).toContain('Karta');
  });

  it('refuses a cancelled order', async () => {
    const admin = await t.db.user.findFirstOrThrow();
    const actor = { id: admin.id, username: admin.username, fullName: null, role: admin.role };
    const dish = await t.db.menuItem.findFirstOrThrow();
    const order = await saveTableOrder(
      t.db,
      actor,
      saveTableOrderInput.parse({ tableNumber: 5, lines: [{ menuItemId: dish.id, quantity: 1 }] }),
    );
    await t.db.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    await expect(printOrderReceipt(t.db, fakePrinter, order.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('preview applies unsaved form values over the saved settings', async () => {
    const url = await previewReceipt(t.db, fakePrinter, {
      restaurantName: 'Yangi nom',
      locale: 'ru',
    });
    const html = decodeURIComponent(url.replace('data:text/html,', ''));
    expect(html).toContain('Yangi nom');
    expect(html).toContain('Итого к оплате');
  });
});
