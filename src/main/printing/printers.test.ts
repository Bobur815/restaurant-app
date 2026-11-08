import { menuItemInput } from '@shared/schemas';
import { createMenuItem, updateMenuItem } from '../menu/menu-items';
import { RECEIPT_SETTINGS_ID, updateReceiptSettings } from '../settings/settings';
import { createTestDb, type TestDb } from '../test-utils/db';
import { pickPrinter } from './printer';
import {
  createPrinter,
  listPrinters,
  mainPrinterName,
  setMainPrinter,
  updatePrinter,
} from './printers';

jest.setTimeout(30_000);

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await t.db.receiptSettings.create({
    data: { id: RECEIPT_SETTINGS_ID, restaurantName: 'Cafe', printerName: null },
  });
});
afterEach(() => t.close());

const receiptPrinterName = async () =>
  (await t.db.receiptSettings.findUniqueOrThrow({ where: { id: RECEIPT_SETTINGS_ID } }))
    .printerName;

describe('printers (feature F11)', () => {
  it('starts with the main printer from the migration; extras are added after it', async () => {
    const [main] = await listPrinters(t.db);
    expect(main).toMatchObject({ isMain: true, windowsName: null, isActive: true, label: null });
    await createPrinter(t.db, { label: 'Oshxona', windowsName: 'XP-80 Kitchen' });
    await createPrinter(t.db, { label: null, windowsName: 'Bar 58' });
    expect((await listPrinters(t.db)).map((p) => [p.label, p.windowsName, p.isMain])).toEqual([
      [null, null, true],
      ['Oshxona', 'XP-80 Kitchen', false],
      [null, 'Bar 58', false],
    ]);
  });

  it('the main printer name stays in step with receipt_settings, both ways', async () => {
    const [main] = await listPrinters(t.db);
    await updatePrinter(t.db, { id: main!.id, windowsName: 'XP-80C', label: 'Kassa' });
    expect(await receiptPrinterName()).toBe('XP-80C');
    expect(await mainPrinterName(t.db)).toBe('XP-80C');

    // An older screen (or setup) writing the receipt setting moves the main printer too.
    await updateReceiptSettings(t.db, { printerName: 'POS-58' });
    expect(await mainPrinterName(t.db)).toBe('POS-58');
    // Other receipt fields leave it alone.
    await updateReceiptSettings(t.db, { footerNote: 'Rahmat' });
    expect(await mainPrinterName(t.db)).toBe('POS-58');
  });

  it('switching the main printer: one main at a time, the old one stays as an extra', async () => {
    const [main] = await listPrinters(t.db);
    const kitchen = await createPrinter(t.db, { label: 'Oshxona', windowsName: 'K-80' });
    const all = await setMainPrinter(t.db, kitchen.id);
    expect(all.map((p) => [p.id, p.isMain])).toEqual([
      [kitchen.id, true],
      [main!.id, false],
    ]);
    expect(await receiptPrinterName()).toBe('K-80');
    expect(await t.db.printer.count({ where: { isMain: true } })).toBe(1);
    // Again on the same one: nothing changes.
    await setMainPrinter(t.db, kitchen.id);
    expect(await t.db.printer.count({ where: { isMain: true } })).toBe(1);
  });

  it('refuses hiding the main printer, an extra without a printer, and a hidden one as main', async () => {
    const [main] = await listPrinters(t.db);
    await expect(updatePrinter(t.db, { id: main!.id, isActive: false })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const bar = await createPrinter(t.db, { label: 'Bar', windowsName: 'B-58' });
    await expect(updatePrinter(t.db, { id: bar.id, windowsName: null })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await updatePrinter(t.db, { id: bar.id, isActive: false });
    expect((await listPrinters(t.db)).map((p) => p.id)).not.toContain(bar.id);
    expect((await listPrinters(t.db, { includeInactive: true })).map((p) => p.id)).toContain(
      bar.id,
    );
    await expect(setMainPrinter(t.db, bar.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('dishes: count per printer; a hidden or unknown printer cannot be chosen, kept if already set', async () => {
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    const bar = await createPrinter(t.db, { label: 'Bar', windowsName: 'B-58' });
    const choy = await createMenuItem(
      t.db,
      menuItemInput.parse({ nameUz: 'Choy', price: '3000', categoryId, printerId: bar.id }),
    );
    expect(choy.printerId).toBe(bar.id);
    expect((await listPrinters(t.db)).find((p) => p.id === bar.id)!.menuItemCount).toBe(1);

    await updatePrinter(t.db, { id: bar.id, isActive: false });
    // Editing something else keeps the (hidden) printer; choosing it anew is refused.
    await expect(
      updateMenuItem(t.db, { id: choy.id, price: '3500', printerId: bar.id }),
    ).resolves.toMatchObject({ printerId: bar.id });
    await expect(
      createMenuItem(
        t.db,
        menuItemInput.parse({ nameUz: 'Kofe', price: '9000', categoryId, printerId: bar.id }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(updateMenuItem(t.db, { id: choy.id, printerId: 999 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(updateMenuItem(t.db, { id: choy.id, printerId: null })).resolves.toMatchObject({
      printerId: null,
    });
  });
});

describe('pickPrinter exact (kitchen printers)', () => {
  const list = [
    { name: 'XP-80C (copy 1) on USB001', isDefault: false },
    { name: 'Microsoft Print to PDF', isDefault: true },
  ];
  it('takes only the printer with that very name (case and spaces aside)', () => {
    expect(pickPrinter(list, 'xp-80c (copy 1) on usb001', { exact: true })).toBe(
      'XP-80C (copy 1) on USB001',
    );
    expect(pickPrinter(list, 'XP-80C', { exact: true })).toBeNull();
  });
  it('never falls back to a guess or the default printer', () => {
    expect(pickPrinter(list, 'Kitchen-58', { exact: true })).toBeNull();
    expect(pickPrinter(list, 'Kitchen-58')).toBe('XP-80C (copy 1) on USB001');
  });
});

describe('review fixes (F11)', () => {
  it('exact never takes a printer whose name only contains the wanted one, or a non-Latin miss', () => {
    const list = [
      { name: 'XP-80C (copy 1)', isDefault: true },
      { name: 'Microsoft Print to PDF', isDefault: false },
    ];
    expect(pickPrinter(list, 'XP-80', { exact: true })).toBeNull();
    expect(pickPrinter(list, 'Кухня', { exact: true })).toBeNull();
    expect(pickPrinter(list, ' xp-80c (COPY 1) ', { exact: true })).toBe('XP-80C (copy 1)');
    // Receipts: a Cyrillic name no longer matches "everything"; the usual guess applies.
    expect(pickPrinter([{ name: 'Кухня', isDefault: false }, ...list], 'Касса')).toBe(
      'XP-80C (copy 1)',
    );
  });
});

describe('making another printer main (F11 review)', () => {
  it('refuses while dishes use a main printer that picks automatically', async () => {
    const t2 = await createTestDb();
    try {
      const [main] = await listPrinters(t2.db);
      const categoryId = (await t2.db.category.findFirstOrThrow()).id;
      await createMenuItem(
        t2.db,
        menuItemInput.parse({ nameUz: 'Non', price: '5000', categoryId, printerId: main!.id }),
      );
      const other = await createPrinter(t2.db, { label: 'Oshxona', windowsName: 'K-80' });
      await expect(setMainPrinter(t2.db, other.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      await updatePrinter(t2.db, { id: main!.id, windowsName: 'XP-80C' });
      await expect(setMainPrinter(t2.db, other.id)).resolves.toHaveLength(2);
    } finally {
      await t2.close();
    }
  });
});
