import { receiptSettingsInput, updateReceiptLayoutInput } from '@shared/schemas';
import { updateReceiptSettings } from '../settings/settings';
import { completeSetup } from '../settings/setup';
import { createTestDb, type TestDb } from '../test-utils/db';
import {
  getPreBillLayout,
  getReceiptLayout,
  getReceiptLayouts,
  preBillReceiptLayout,
  receiptImageNames,
  updatePreBillLayout,
  updateReceiptLayout,
} from './layouts';

jest.setTimeout(60_000);

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await completeSetup(t.db, {
    admin: { fullName: 'Ega', phone: '998900000001', pin: '1234' },
    receipt: receiptSettingsInput.parse({ restaurantName: 'Shoxona', footerNote: 'Rahmat!' }),
    tableCount: 3,
  });
});
afterEach(() => t.close());

const img = (c: string) => `${c.repeat(32)}.png`;

describe('receipt layouts', () => {
  it('before anything is saved, every type prints like the old receipt settings', async () => {
    await updateReceiptSettings(t.db, { printShowPhone: false });
    const layouts = await getReceiptLayouts(t.db);
    expect(layouts.map((l) => l.orderType)).toEqual(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
    for (const l of layouts) {
      expect(l).toMatchObject({
        saved: false,
        showPhone: false,
        showAddress: true,
        footerNote: 'Rahmat!',
        topImage: null,
        bottomImage: null,
      });
    }
  });

  it('delivery and takeaway follow General until they are saved themselves', async () => {
    await updateReceiptLayout(t.db, {
      orderType: 'DINE_IN',
      footerNote: 'Umumiy',
      topImage: img('a'),
      topImageWidth: 80,
    });
    expect(await getReceiptLayout(t.db, 'DELIVERY')).toMatchObject({
      orderType: 'DELIVERY',
      saved: false,
      footerNote: 'Umumiy',
      topImage: img('a'),
      topImageWidth: 80,
    });

    // Saving delivery starts from what it printed (General) and keeps only its own changes.
    await updateReceiptLayout(t.db, {
      orderType: 'DELIVERY',
      showCustomer: false,
      bottomImage: img('b'),
    });
    await updateReceiptLayout(t.db, { orderType: 'DINE_IN', footerNote: 'Yangi umumiy' });
    expect(await getReceiptLayout(t.db, 'DELIVERY')).toMatchObject({
      saved: true,
      footerNote: 'Umumiy',
      topImage: img('a'),
      bottomImage: img('b'),
      showCustomer: false,
    });
    expect(await getReceiptLayout(t.db, 'TAKEAWAY')).toMatchObject({
      saved: false,
      footerNote: 'Yangi umumiy',
    });

    // A picture removed from a layout is null; the cleanup keeps only pictures in use.
    await updateReceiptLayout(t.db, { orderType: 'DELIVERY', topImage: null });
    expect((await receiptImageNames(t.db)).sort()).toEqual([img('a'), img('b')]);
  });

  it('pre-bill: General without pictures until saved, then its own', async () => {
    await updateReceiptLayout(t.db, {
      orderType: 'DINE_IN',
      showPhone: false,
      footerNote: 'Umumiy',
      topImage: img('a'),
    });
    await updateReceiptLayout(t.db, { orderType: 'DELIVERY', showCustomer: false });
    expect(await getPreBillLayout(t.db)).toMatchObject({
      saved: false,
      showPhone: false,
      footerNote: 'Umumiy',
      topImage: null,
      bottomImage: null,
    });

    await updatePreBillLayout(t.db, { footerNote: 'Hisob', bottomImage: img('c') });
    await updatePreBillLayout(t.db, { showAddress: false });
    expect(await getPreBillLayout(t.db)).toMatchObject({
      saved: true,
      showPhone: false,
      showAddress: false,
      footerNote: 'Hisob',
      bottomImage: img('c'),
    });
    expect(await t.db.preBillLayout.count()).toBe(1);
    // The customer block follows the order type's own receipt.
    expect(await preBillReceiptLayout(t.db, 'DELIVERY')).toMatchObject({
      orderType: 'DELIVERY',
      showCustomer: false,
      footerNote: 'Hisob',
    });
    // Delivery saved a copy of General's picture: the name is listed for both.
    expect(new Set(await receiptImageNames(t.db))).toEqual(new Set([img('a'), img('c')]));
  });

  it('accepts only names the image store issues and widths of 20-100%', () => {
    const parse = (v: object) => updateReceiptLayoutInput.safeParse({ orderType: 'DINE_IN', ...v });
    expect(parse({ topImage: img('a'), topImageWidth: 100 }).success).toBe(true);
    expect(parse({ topImage: null }).success).toBe(true);
    expect(parse({ topImage: '../../secret.png' }).success).toBe(false);
    expect(parse({ topImage: 'C:\\logo.png' }).success).toBe(false);
    expect(parse({ bottomImageWidth: 10 }).success).toBe(false);
    expect(parse({ bottomImageWidth: 101 }).success).toBe(false);
    expect(updateReceiptLayoutInput.safeParse({ orderType: 'OTHER' }).success).toBe(false);
  });
});
