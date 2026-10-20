import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PrismaClient } from '../../generated/prisma-sqlite';
import { DEFAULT_HALL_NAME, HALLS_SEEDED_KEY } from '../halls/halls';
import { getUserVersion, splitStatements } from './migrate';
import { MIGRATIONS, type Migration } from './migrations';
import { loadPrismaModule, openDatabase } from './open';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './seed';

jest.setTimeout(60_000);

const ROOT = path.join(__dirname, '..', '..', '..');
const SCHEMA = path.join(ROOT, 'prisma', 'schema.sqlite.prisma');
const prismaModule = loadPrismaModule(ROOT);
const LATEST = MIGRATIONS.length;
const NEXT = LATEST + 1;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'savdochef-db-'));
const open: PrismaClient[] = [];
let n = 0;

function newDbFile(): string {
  return path.join(tmpRoot, `t${++n}`, 'savdochef.db');
}

async function openAt(
  dbFile: string,
  extra: { migrations?: readonly Migration[]; backupDir?: string } = {},
) {
  const db = await openDatabase(dbFile, { prismaModule, ...extra });
  open.push(db.prisma);
  return db;
}

afterAll(async () => {
  await Promise.all(open.map((p) => p.$disconnect().catch(() => undefined)));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('migrations match prisma/schema.sqlite.prisma', () => {
  it('a database built only from MIGRATIONS has no drift from the Prisma schema', async () => {
    const dbFile = newDbFile();
    const { prisma } = await openAt(dbFile);
    await prisma.$disconnect();

    const prismaCli = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
    const diff = execFileSync(
      process.execPath,
      [
        prismaCli,
        'migrate',
        'diff',
        '--from-url',
        `file:${dbFile}`,
        '--to-schema-datamodel',
        SCHEMA,
        '--script',
      ],
      { encoding: 'utf8', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } },
    );
    const sql = diff.replace(/^-- This is an empty migration\.\s*$/m, '').trim();

    // If this fails, the schema changed without a migration. Add the SQL printed below as the
    // next entry in src/main/database/migrations/ (additive changes only).
    expect(sql).toBe('');
  });
});

describe('openDatabase', () => {
  it('creates a fresh database at the latest version with seed data', async () => {
    const { prisma, migration, freshDatabase } = await openAt(newDbFile());

    expect(freshDatabase).toBe(true);
    expect(migration).toEqual({
      from: 0,
      to: MIGRATIONS.length,
      applied: MIGRATIONS.map((m) => `${m.version}_${m.name}`),
    });
    expect(await getUserVersion(prisma)).toBe(MIGRATIONS.length);

    const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(categories.map((c) => c.nameUz)).toEqual(DEFAULT_CATEGORIES.map((c) => c.nameUz));
    // + the internal flag that the first hall was created.
    expect(await prisma.setting.count()).toBe(Object.keys(DEFAULT_SETTINGS).length + 1);
    expect(await prisma.setting.findUnique({ where: { key: HALLS_SEEDED_KEY } })).not.toBeNull();
    const halls = await prisma.hall.findMany({ include: { tables: true } });
    expect(halls.map((h) => [h.name, h.tables.length])).toEqual([[DEFAULT_HALL_NAME, 10]]);
    expect(await prisma.counter.findUnique({ where: { name: 'orders' } })).toEqual({
      name: 'orders',
      value: 0,
    });

    const mode = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode');
    expect(mode[0]?.journal_mode).toBe('wal');
  });

  it('reopening runs no migration, keeps user changes and does not re-add deleted categories', async () => {
    const dbFile = newDbFile();
    const first = await openAt(dbFile);
    await first.prisma.setting.update({ where: { key: 'table_count' }, data: { value: '24' } });
    await first.prisma.category.deleteMany();
    await first.prisma.$disconnect();

    const second = await openAt(dbFile);
    expect(second.freshDatabase).toBe(false);
    expect(second.migration.applied).toEqual([]);
    expect((await second.prisma.setting.findUnique({ where: { key: 'table_count' } }))?.value).toBe(
      '24',
    );
    expect(await second.prisma.category.count()).toBe(0);
  });

  it('backs up before upgrading an existing database, then applies the new migration', async () => {
    const dbFile = newDbFile();
    const backupDir = path.join(path.dirname(dbFile), 'backups');
    const v1 = await openAt(dbFile, { backupDir });
    await v1.prisma.category.create({ data: { nameUz: 'Backup marker' } });
    await v1.prisma.$disconnect();
    expect(fs.existsSync(backupDir)).toBe(false); // fresh database: nothing to back up

    const v2: Migration = {
      version: NEXT,
      name: 'test_table',
      sql: 'CREATE TABLE "zz_test" ("id" INTEGER NOT NULL);',
    };
    const upgraded = await openAt(dbFile, { backupDir, migrations: [...MIGRATIONS, v2] });
    expect(upgraded.migration).toEqual({ from: LATEST, to: NEXT, applied: [`${NEXT}_test_table`] });

    const backups = fs.readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(new RegExp(`^savdochef-v${LATEST}-.*\\.db$`));

    // The backup is a complete, openable v1 database with the data in it.
    const restored = await openAt(path.join(backupDir, backups[0]!));
    expect(restored.migration.from).toBe(LATEST);
    expect(
      await restored.prisma.category.findUnique({ where: { nameUz: 'Backup marker' } }),
    ).not.toBeNull();
  });

  it('a failing migration leaves the database at the previous version, untouched', async () => {
    const dbFile = newDbFile();
    (await openAt(dbFile)).prisma.$disconnect();

    const broken: Migration = {
      version: NEXT,
      name: 'broken',
      sql: 'CREATE TABLE "zz_half" ("id" INTEGER);\nTHIS IS NOT SQL;',
    };
    await expect(openAt(dbFile, { migrations: [...MIGRATIONS, broken] })).rejects.toThrow();

    const after = await openAt(dbFile);
    expect(await getUserVersion(after.prisma)).toBe(LATEST);
    const tables = await after.prisma.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'zz_half'",
    );
    expect(tables).toEqual([]);
  });

  it('refuses a database created by a newer app version', async () => {
    const dbFile = newDbFile();
    const v2: Migration = {
      version: NEXT,
      name: 'future',
      sql: 'CREATE TABLE "zz_future" ("id" INTEGER);',
    };
    (await openAt(dbFile, { migrations: [...MIGRATIONS, v2] })).prisma.$disconnect();

    await expect(openAt(dbFile)).rejects.toThrow(/newer than this app/);
  });
});

describe('splitStatements', () => {
  it('keeps a CREATE TRIGGER body together', () => {
    const sql = [
      'UPDATE t SET x = 1;',
      'CREATE TRIGGER tr AFTER UPDATE ON t',
      'BEGIN',
      '  UPDATE t SET y = 2 WHERE id = NEW.id;',
      '  UPDATE t SET z = 3 WHERE id = NEW.id;',
      'END;',
      'CREATE INDEX i ON t(x);',
    ].join('\n');
    const parts = splitStatements(sql);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toMatch(/^CREATE TRIGGER tr[\s\S]*z = 3 WHERE id = NEW\.id;\nEND$/);
  });

  it('drops comments and splits on statement ends', () => {
    expect(
      splitStatements('-- c\nCREATE TABLE a (x INT);\n\n-- d\nCREATE INDEX i ON a(x);\n'),
    ).toEqual(['CREATE TABLE a (x INT)', 'CREATE INDEX i ON a(x)']);
  });
});

describe('migration 7 (order types) on a database with orders', () => {
  it('keeps every order, line and payment; old orders are dine-in; open orders need no table', async () => {
    const dbFile = newDbFile();
    // A v6 database, written with plain SQL (the v7 client would ask for columns v6 lacks).
    const v6 = await openAt(dbFile, { migrations: MIGRATIONS.slice(0, 6) });
    const p = v6.prisma;
    const category = await p.category.findFirstOrThrow();
    const dish = await p.menuItem.create({
      data: { nameUz: 'Non', price: '5000', categoryId: category.id },
    });
    await p.$executeRawUnsafe(
      `INSERT INTO "sessions" ("id", "status", "openGuard", "updatedAt") VALUES (1, 'open', 1, CURRENT_TIMESTAMP)`,
    );
    for (const [id, status, table] of [
      [1, 'completed', 3],
      [2, 'pending', 4],
    ] as const) {
      await p.$executeRawUnsafe(
        `INSERT INTO "orders" ("id", "orderNumber", "tableNumber", "status", "sessionId", "totalAmount", "updatedAt") VALUES (${id}, '2026-0000${id}', ${table}, '${status}', 1, 10000, CURRENT_TIMESTAMP)`,
      );
      await p.$executeRawUnsafe(
        `INSERT INTO "order_items" ("orderId", "menuItemId", "quantity", "unitPrice", "totalPrice", "stockQuantity", "updatedAt") VALUES (${id}, ${dish.id}, 2, 5000, 10000, 2, CURRENT_TIMESTAMP)`,
      );
    }
    await p.$executeRawUnsafe(
      `INSERT INTO "payments" ("orderId", "amount", "method", "updatedAt") VALUES (1, 10000, 'cash', CURRENT_TIMESTAMP)`,
    );
    await p.$disconnect();

    const v7 = await openAt(dbFile);
    expect(v7.migration.applied).toContain('7_order_types_customers');
    const db = v7.prisma;
    expect(await db.order.count()).toBe(2);
    expect(await db.orderItem.count()).toBe(2);
    expect(await db.payment.count()).toBe(1);
    const orders = await db.order.findMany({ orderBy: { id: 'asc' } });
    expect(orders.map((o) => [o.orderType, o.pendingTable, o.deliveryFee.toString()])).toEqual([
      ['DINE_IN', null, '0'],
      ['DINE_IN', 4, '0'],
    ]);

    // The replaced trigger: open takeaway orders (tableNumber 0) never collide with each other.
    for (const n of [3, 4]) {
      await db.order.create({
        data: { orderNumber: `T-${n}`, tableNumber: 0, orderType: 'TAKEAWAY', sessionId: 1 },
      });
    }
    expect(
      await db.order.count({
        where: { orderType: 'TAKEAWAY', status: 'pending', pendingTable: null },
      }),
    ).toBe(2);
    // ...and a dine-in table is still one pending order only.
    await expect(
      db.order.create({ data: { orderNumber: 'D-4', tableNumber: 4, sessionId: 1 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('migration 8 (split payment, debt) on a database with payments', () => {
  it('keeps every payment; old debt stays open, without a customer, until assigned', async () => {
    const dbFile = newDbFile();
    const v7 = await openAt(dbFile, { migrations: MIGRATIONS.slice(0, 7) });
    const p = v7.prisma;
    await p.$executeRawUnsafe(
      `INSERT INTO "sessions" ("id", "status", "openGuard", "updatedAt") VALUES (1, 'open', 1, CURRENT_TIMESTAMP)`,
    );
    await p.$executeRawUnsafe(
      `INSERT INTO "orders" ("id", "orderNumber", "tableNumber", "status", "sessionId", "totalAmount", "updatedAt") VALUES (1, '2026-00001', 2, 'completed', 1, 15000, CURRENT_TIMESTAMP)`,
    );
    for (const [method, status] of [
      ['cash', 'paid'],
      ['debt', 'pending'],
    ] as const) {
      await p.$executeRawUnsafe(
        `INSERT INTO "payments" ("orderId", "amount", "method", "status", "updatedAt") VALUES (1, 7500, '${method}', '${status}', CURRENT_TIMESTAMP)`,
      );
    }
    await p.$disconnect();

    const v8 = await openAt(dbFile);
    expect(v8.migration.applied).toContain('8_split_payment_debt');
    const payments = await v8.prisma.payment.findMany({ orderBy: { id: 'asc' } });
    expect(
      payments.map((x) => [x.method, x.status, x.amount.toString(), x.customerId, x.settledAt]),
    ).toEqual([
      ['cash', 'paid', '7500', null, null],
      ['debt', 'pending', '7500', null, null],
    ]);
    expect(await v8.prisma.debtRepayment.count()).toBe(0);
  });
});

describe('database-level guarantees', () => {
  let prisma: PrismaClient;
  let menuItemId: number;

  beforeAll(async () => {
    ({ prisma } = await openAt(newDbFile()));
    const category = await prisma.category.findFirstOrThrow();
    menuItemId = (
      await prisma.menuItem.create({
        data: {
          nameUz: 'Osh',
          nameRu: 'Плов',
          price: '25000.50',
          categoryId: category.id,
          hasPortions: true,
        },
      })
    ).id;
  });

  it('stores Decimal money exactly', async () => {
    const item = await prisma.menuItem.findUniqueOrThrow({ where: { id: menuItemId } });
    expect(item.price.toString()).toBe('25000.5');
  });

  it('allows only one open session; the guard follows status via triggers (migration 2)', async () => {
    const guardOf = async (id: number) =>
      (await prisma.session.findUniqueOrThrow({ where: { id } })).openGuard;

    const s1 = await prisma.session.create({ data: {} });
    expect(await guardOf(s1.id)).toBe(1);
    await expect(prisma.session.create({ data: {} })).rejects.toMatchObject({ code: 'P2002' });

    // Closing by status alone releases the guard; no code has to remember openGuard.
    await prisma.session.update({
      where: { id: s1.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    expect(await guardOf(s1.id)).toBeNull();

    const s2 = await prisma.session.create({ data: {} });

    // Reopening s1 while s2 is open is refused, and s1 stays closed.
    await expect(
      prisma.session.update({ where: { id: s1.id }, data: { status: 'open' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s1.id } })).status).toBe(
      'closed',
    );

    // Writing openGuard directly cannot drop the guard of an open session.
    await prisma.session.update({ where: { id: s2.id }, data: { openGuard: null } });
    expect(await guardOf(s2.id)).toBe(1);

    // With s2 closed, s1 may be reopened (and takes the guard back).
    await prisma.session.update({ where: { id: s2.id }, data: { status: 'closed' } });
    await prisma.session.update({ where: { id: s1.id }, data: { status: 'open' } });
    expect(await guardOf(s1.id)).toBe(1);
    await prisma.session.update({ where: { id: s1.id }, data: { status: 'closed' } });
  });

  it('allows only one pending order per table; the guard follows status via triggers (migration 3)', async () => {
    const session = await prisma.session.create({ data: {} });
    const base = { tableNumber: 3, sessionId: session.id };
    const pendingTableOf = async (id: number) =>
      (await prisma.order.findUniqueOrThrow({ where: { id } })).pendingTable;

    const o1 = await prisma.order.create({ data: { ...base, orderNumber: '2026-00001' } });
    expect(await pendingTableOf(o1.id)).toBe(3);
    await expect(
      prisma.order.create({ data: { ...base, orderNumber: '2026-00002' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Another table is independent.
    const other = await prisma.order.create({
      data: { ...base, tableNumber: 4, orderNumber: '2026-00004' },
    });

    // Paying (or cancelling) by status alone releases the table.
    await prisma.order.update({ where: { id: o1.id }, data: { status: 'completed' } });
    expect(await pendingTableOf(o1.id)).toBeNull();
    const o3 = await prisma.order.create({ data: { ...base, orderNumber: '2026-00003' } });

    // Moving a pending order onto an occupied table is refused.
    await expect(
      prisma.order.update({ where: { id: other.id }, data: { tableNumber: 3 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Writing the guard directly cannot drop it.
    await prisma.order.update({ where: { id: o3.id }, data: { pendingTable: null } });
    expect(await pendingTableOf(o3.id)).toBe(3);

    await prisma.order.updateMany({ data: { status: 'completed' } });
    await prisma.session.update({
      where: { id: session.id },
      data: { status: 'closed' },
    });
  });

  it('enforces foreign keys: order items cascade with the order, payments block deleting it', async () => {
    const session = await prisma.session.create({ data: {} });
    const order = await prisma.order.create({
      data: {
        orderNumber: '2026-00010',
        tableNumber: 1,
        sessionId: session.id,
        items: {
          create: {
            menuItemId,
            quantity: 1,
            unitPrice: '25000.5',
            totalPrice: '25000.5',
            stockQuantity: 1,
          },
        },
      },
    });

    await expect(
      prisma.orderItem.create({ data: { orderId: order.id, menuItemId: 999_999 } }),
    ).rejects.toMatchObject({ code: 'P2003' });

    const paid = await prisma.order.create({
      data: {
        orderNumber: '2026-00011',
        tableNumber: 2,
        sessionId: session.id,
        payments: { create: { amount: '1000', method: 'cash' } },
      },
    });
    await expect(prisma.order.delete({ where: { id: paid.id } })).rejects.toThrow();

    await prisma.order.delete({ where: { id: order.id } });
    expect(await prisma.orderItem.count({ where: { orderId: order.id } })).toBe(0);
    await prisma.session.update({
      where: { id: session.id },
      data: { status: 'closed' },
    });
  });

  it('a dish split into carry + write-off can be applied to the next session (legacy quirk 5)', async () => {
    const closed = await prisma.session.create({ data: {} });
    await prisma.session.update({
      where: { id: closed.id },
      data: { status: 'closed' },
    });

    const expense = await prisma.expense.create({
      data: {
        sessionId: closed.id,
        menuItemId,
        type: 'residual_writeoff',
        quantity: 1,
        unitCost: 25000,
        amount: 25000,
      },
    });
    await prisma.residual.create({
      data: {
        sessionId: closed.id,
        menuItemId,
        quantity: 2,
        action: 'CARRY_TO_NEXT',
        status: 'pending',
      },
    });
    await prisma.residual.create({
      data: {
        sessionId: closed.id,
        menuItemId,
        quantity: 1,
        action: 'WRITE_OFF',
        status: 'applied',
        expenseId: expense.id,
      },
    });

    const next = await prisma.session.create({ data: {} });
    const res = await prisma.residual.updateMany({
      where: { sessionId: closed.id, action: 'CARRY_TO_NEXT', status: 'pending' },
      data: { status: 'applied', appliedToSessionId: next.id },
    });
    expect(res.count).toBe(1);

    await expect(
      prisma.residual.create({
        data: {
          sessionId: closed.id,
          menuItemId,
          quantity: 1,
          action: 'WRITE_OFF',
          status: 'applied',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('a menu item in use cannot be hard-deleted (soft delete via isActive instead)', async () => {
    await expect(prisma.menuItem.delete({ where: { id: menuItemId } })).rejects.toThrow();
  });
});
