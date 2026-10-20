import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PrismaClient } from '../../generated/prisma-sqlite';
import { getSetupStatus } from '../settings/setup';
import { createTestDb, type TestDb } from '../test-utils/db';
import { importLegacy, readLegacy } from './legacy-import';
import { loadPrismaModule } from './open';

jest.setTimeout(60_000);

const ROOT = path.join(__dirname, '..', '..', '..');
const { PrismaClient: Client } = loadPrismaModule(ROOT);

// The legacy schema's tables, as the legacy migrations created them (columns used by the import).
const LEGACY_DDL = [
  `CREATE TABLE "User" (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, password TEXT, role TEXT, is_active BOOLEAN, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "Category" (id INTEGER PRIMARY KEY, name TEXT, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "Menu" (id INTEGER PRIMARY KEY, name TEXT, price DECIMAL, imageUrl TEXT, description TEXT, categoryId INTEGER, portions BOOLEAN, soldByWeight BOOLEAN, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "Session" (id INTEGER PRIMARY KEY, status TEXT, closedAt DATETIME, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "SessionItem" (id INTEGER PRIMARY KEY, sessionId INTEGER, menuId INTEGER, initialQuantity DECIMAL, soldQuantity DECIMAL)`,
  `CREATE TABLE "Order" (id INTEGER PRIMARY KEY, orderNumber TEXT, tableNumber INTEGER, orderDate DATETIME, totalAmount DECIMAL, status TEXT, paymentMethod TEXT, updateDate DATETIME)`,
  `CREATE TABLE "OrderItem" (id INTEGER PRIMARY KEY, orderId INTEGER, menuId INTEGER, soldByWeight BOOLEAN, quantity DECIMAL, units INTEGER, weightKg DECIMAL, portions DECIMAL, unitPrice DECIMAL, totalPrice DECIMAL, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "Payment" (id INTEGER PRIMARY KEY, orderId INTEGER, amount DECIMAL, paymentDate DATETIME, paymentMethod TEXT, status TEXT, createdAt DATETIME)`,
  `CREATE TABLE "Expense" (id INTEGER PRIMARY KEY, sessionId INTEGER, menuId INTEGER, type TEXT, note TEXT, quantity DECIMAL, unitCost DECIMAL, amount DECIMAL, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "Residual" (id INTEGER PRIMARY KEY, sessionId INTEGER, menuId INTEGER, quantity DECIMAL, action TEXT, status TEXT, appliedToSession INTEGER, expenseId INTEGER, note TEXT, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "RecieptSettings" (id INTEGER PRIMARY KEY, restaurantName TEXT, address TEXT, phone TEXT, extraPhones TEXT, footerNote TEXT, locale TEXT, currency TEXT, print_widthPx INTEGER, print_useStarsSep BOOLEAN, print_separatorChar TEXT, print_separatorCount INTEGER, print_showAddress BOOLEAN, print_showPhone BOOLEAN, print_showDateTime BOOLEAN, print_showOrderNumber BOOLEAN, logoUrl TEXT, slug TEXT, createdAt DATETIME, updatedAt DATETIME)`,
  `CREATE TABLE "Counter" (id TEXT PRIMARY KEY, seq INTEGER)`,
];

// Shaped like the real legacy data, quirks included (ms timestamps as in legacy).
const T0 = 1759556306755; // shift opened
const T1 = 1759599812797; // shift closed
const LEGACY_ROWS = [
  `INSERT INTO "User" VALUES (1, 'admin', 'admin', '123456', 'ADMIN', 1, ${T0}, ${T0})`,
  `INSERT INTO "Category" VALUES (1, 'Ovqatlar', ${T0}, ${T0}), (3, 'Ichimliklar', ${T0}, ${T0}), (9, 'Shirinliklar', ${T0}, ${T0})`,
  `INSERT INTO "Menu" VALUES (1, 'Osh', 35000, 'osh.jpg', NULL, 1, 0, 1, ${T0}, ${T0}),
     (2, 'Bishteks', 20000, 'bishteks.jpg', NULL, 1, 1, 0, ${T0}, ${T0}),
     (3, 'Choy', 3000, 'missing.jpg', NULL, 3, 0, 0, ${T0}, ${T0}),
     (4, 'Tort', 25000, NULL, 'Shokoladli', 9, 0, 0, ${T0}, ${T0})`,
  `INSERT INTO "Session" VALUES (2, 'closed', ${T1}, ${T0}, ${T1})`,
  `INSERT INTO "SessionItem" VALUES (11, 2, 1, 9, 6), (12, 2, 2, 9, 8.5), (13, 2, 3, 6, 4)`,
  `INSERT INTO "Order" VALUES (1, '2025-00001', 2, ${T0 + 30000}, 52000, 'completed', 'cash', ${T0 + 40000}),
     (2, '2025-00002', 2, ${T0 + 60000}, 68000, 'completed', 'cash', ${T0 + 70000}),
     (3, '2025-00003', 4, ${T1 + 86400000}, 14000, 'completed', 'klik', ${T1 + 86400000})`,
  // Line 1: legacy's own total is inconsistent (1 x 0.5 kg x 35 000 = 17 500, recorded 35 000).
  `INSERT INTO "OrderItem" VALUES (1, 1, 1, 1, 1, 1, 0.5, NULL, 35000, 35000, ${T0}, ${T0}),
     (2, 1, 2, 0, 1, NULL, NULL, 0.7, 20000, 14000, ${T0}, ${T0}),
     (3, 1, 3, 0, 1, NULL, NULL, 1, 3000, 3000, ${T0}, ${T0}),
     (9, 2, 1, 1, 2, 1, 0.5, NULL, 35000, 35000, ${T0}, ${T0}),
     (10, 2, 2, 0, 3, NULL, NULL, NULL, 11000, 33000, ${T0}, ${T0}),
     (20, 3, 2, 0, 1, NULL, NULL, 0.7, 14000, 14000, ${T0}, ${T0})`,
  // Order 2 has no payment (legacy "delete check").
  `INSERT INTO "Payment" VALUES (1, 1, 52000, ${T0 + 40000}, 'cash', 'paid', ${T0}), (3, 3, 14000, ${T1 + 86400000}, 'klik', 'paid', ${T0})`,
  `INSERT INTO "Residual" VALUES (1, 2, 1, 3, 'CARRY_TO_NEXT', 'pending', NULL, NULL, '', ${T1}, ${T1}),
     (2, 2, 2, 0.5, 'CARRY_TO_NEXT', 'pending', NULL, NULL, '', ${T1}, ${T1})`,
  `INSERT INTO "RecieptSettings" VALUES (1, 'Shoxona', 'Arabmozor', '+998 90 000 00 00', '', 'Xaridingiz uchun rahmat !', 'uz-UZ', 'UZS', 420, 1, '*', 38, 1, 1, 1, 1, NULL, 'default', ${T0}, ${T0})`,
  `INSERT INTO "Counter" VALUES ('orders', 10)`,
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'savdochef-legacy-'));
let legacy: PrismaClient;

beforeAll(async () => {
  legacy = new Client({ datasources: { db: { url: `file:${path.join(tmp, 'app.db')}` } } });
  for (const sql of [...LEGACY_DDL, ...LEGACY_ROWS]) await legacy.$executeRawUnsafe(sql);
});
afterAll(async () => {
  await legacy.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const images = (copied: string[]) => (name: string) => {
  if (name === 'missing.jpg') return null;
  copied.push(name);
  return `${name.replace(/\W/g, '')}`.padEnd(32, '0').slice(0, 32) + '.jpg';
};

describe('legacy import', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  it('imports everything, keeping recorded money and computing stock use', async () => {
    const copied: string[] = [];
    const report = await importLegacy(t.db, await readLegacy(legacy), {
      copyImage: images(copied),
    });

    expect(report).toMatchObject({
      categories: { created: 1, reused: 2 },
      menuItems: 4,
      images: { copied: 2, missing: ['missing.jpg'] },
      users: 1,
      sessions: 1,
      sessionItems: 3,
      orders: 3,
      orderItems: 6,
      payments: 2,
      residuals: 2,
      receiptSettings: true,
      paymentsTotal: '66000',
      dryRun: false,
    });
    expect(report.warnings).toEqual([expect.stringContaining('2025-00002')]);

    // No password comes along (login is a PIN): the username becomes the name, the role gives
    // the permissions; setup complete, receipt mapped.
    const admin = await t.db.user.findFirstOrThrow({ where: { fullName: 'admin' } });
    expect(admin).toMatchObject({ role: 'ADMIN', pinHash: null, phone: null });
    expect(JSON.parse(admin.permissions)).toContain('users');
    expect(JSON.stringify(admin)).not.toContain('123456');
    expect(await getSetupStatus(t.db)).toEqual({ setupComplete: true, hasAdmin: true });
    expect(await t.db.receiptSettings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
      restaurantName: 'Shoxona',
      locale: 'uz',
    });

    // Dishes: kinds and categories.
    const osh = await t.db.menuItem.findUniqueOrThrow({
      where: { nameUz: 'Osh' },
      include: { category: true },
    });
    expect(osh).toMatchObject({
      soldByWeight: true,
      hasPortions: false,
      category: { nameUz: 'Ovqatlar' },
    });
    expect(
      (await t.db.menuItem.findUniqueOrThrow({ where: { nameUz: 'Choy' } })).imageFile,
    ).toBeNull();

    // Orders: money as recorded, stock as computed now, shift assignment.
    const o1 = await t.db.order.findUniqueOrThrow({
      where: { orderNumber: '2025-00001' },
      include: { items: { orderBy: { id: 'asc' } }, payments: true },
    });
    expect(o1.totalAmount.toString()).toBe('52000');
    expect(
      o1.items.map((i) => [
        i.totalPrice.toString(),
        i.stockQuantity.toString(),
        i.portion?.toString() ?? null,
      ]),
    ).toEqual([
      ['35000', '0.5', null],
      ['14000', '0.7', '0.7'],
      ['3000', '1', null],
    ]);
    const session = await t.db.session.findFirstOrThrow();
    expect(o1.sessionId).toBe(session.id);
    // Order 3 is after the only shift closed: goes to the last shift opened before it.
    const o3 = await t.db.order.findUniqueOrThrow({
      where: { orderNumber: '2025-00003' },
      include: { payments: true },
    });
    expect(o3).toMatchObject({
      sessionId: session.id,
      paymentMethod: 'click',
      payments: [expect.objectContaining({ method: 'click' })],
    });

    // Bishteks with legacy portions = null on a portion dish -> full portion.
    const o2 = await t.db.order.findUniqueOrThrow({
      where: { orderNumber: '2025-00002' },
      include: { items: true },
    });
    expect(o2.items.find((i) => i.totalPrice.toString() === '33000')).toMatchObject({
      quantity: expect.anything(),
    });
    expect(
      o2.items.find((i) => i.totalPrice.toString() === '33000')!.stockQuantity.toString(),
    ).toBe('3');

    // Leftovers pending -> the next shift will offer them; order numbers continue after legacy.
    expect(
      await t.db.residual.count({ where: { status: 'pending', action: 'CARRY_TO_NEXT' } }),
    ).toBe(2);
    expect((await t.db.counter.findUniqueOrThrow({ where: { name: 'orders' } })).value).toBe(10);
  });

  it('a dry run reports the same and writes nothing', async () => {
    const report = await importLegacy(t.db, await readLegacy(legacy), { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, orders: 3, payments: 2, paymentsTotal: '66000' });
    expect(await t.db.order.count()).toBe(0);
    expect(await t.db.user.count()).toBe(0);
    expect(await t.db.menuItem.count()).toBe(0);
  });

  it('refuses a database that already has business data', async () => {
    await t.db.user.create({ data: { fullName: 'x' } });
    await expect(importLegacy(t.db, await readLegacy(legacy))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses something that is not a legacy database', async () => {
    const other = new Client({
      datasources: { db: { url: `file:${path.join(tmp, 'other.db')}` } },
    });
    await other.$executeRawUnsafe('CREATE TABLE "Foo" (id INTEGER)');
    await expect(readLegacy(other)).rejects.toThrow(/legacy SavdoChef/);
    await other.$disconnect();
  });
});
