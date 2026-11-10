import type { IpcChannel } from '@shared/ipc';
import type { Actor } from '../domain/db';
import { toCurrentUser } from '../auth/auth';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { unsupportedUpdater } from '../test-utils/updater';
import { allowAllLicense } from '../test-utils/license';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext } from './ipc-safe';
import { TableLocks } from '../orders/table-locks';

jest.setTimeout(60_000);

let t: TestDb;
let admin: Actor;
let staff: Actor;
/** Logged in, but with no permission at all. */
let nobody: Actor;
const logged: Array<[string, unknown]> = [];

beforeAll(async () => {
  t = await createTestDb();
  admin = await createUser(t.db, { username: 'admin', role: 'ADMIN', pin: '1111' });
  staff = await createUser(t.db, { username: 'staff', role: 'STAFF', pin: '2222' });
  nobody = await createUser(t.db, { username: 'nobody', permissions: [] });
});
afterAll(() => t.close());

/** One main till's table locks, shared by every fake window (F13). */
const tableLocks = new TableLocks();
let terminals = 0;

/** A fake window: holds its own login like register.ts does per webContents. */
function caller(initial: Actor | null = null) {
  const terminal = `local:${++terminals}`;
  let actor = initial;
  const ctx = (): HandlerContext => ({
    db: t.db,
    actor,
    setActor: (a) => {
      actor = a;
    },
    terminal,
    services: {
      appInfo: () => ({ name: 'savdochef', version: '0.0.0-test', isPackaged: false }),
      printer: {
        list: async () => [],
        print: async () => ({ printer: 'Test' }),
        preview: async () => 'data:image/png;base64,',
      },
      pickImage: async () => null,
      receiptImage: () => null,
      tableLocks,
      updater: unsupportedUpdater(),
      license: allowAllLicense(),
    },
    log: (message, error) => logged.push([message, error]),
  });
  return {
    call: <C extends IpcChannel>(channel: C, input?: unknown) =>
      invokeHandler(channel, HANDLERS[channel] as never, ctx(), input),
    get actor() {
      return actor;
    },
  };
}

describe('access levels', () => {
  it('matches the reviewed list (update deliberately when adding a channel)', () => {
    const byAccess: Record<string, string[]> = {};
    for (const [channel, def] of Object.entries(HANDLERS))
      (byAccess[def.access] ??= []).push(channel);
    expect(byAccess).toEqual({
      public: [
        'app:info',
        'auth:pinLogin',
        'auth:logout',
        'auth:me',
        'auth:recover',
        'auth:bootstrapStatus',
        'auth:bootstrapPin',
        'setup:status',
        'setup:complete',
        'settings:get',
        'receipt:get',
        'license:status',
        'license:checkNow',
        'license:plans',
        'license:signupStart',
        'license:signupStatus',
        'license:signupComplete',
        'license:activate',
        'lan:link',
        'lan:join',
        'lan:leave',
      ],
      user: [
        'users:updateProfile',
        'printing:printReceipt',
        'printing:printPreBill',
        'printers:list',
        'halls:list',
        'categories:list',
        'menu:list',
        'menu:get',
        'sessions:getOpen',
        'sessions:get',
        'sessions:list',
        'sessions:pendingCarry',
        'sessions:lastUnlimited',
        'orders:busyTables',
        'orders:getTable',
        'orders:tableLocks',
        'residuals:list',
      ],
      users: [
        'auth:recoveryStatus',
        'auth:newRecoveryCode',
        'users:list',
        'users:create',
        'users:update',
      ],
      settings: [
        'settings:update',
        'receipt:update',
        'receipt:layouts',
        'receipt:updateLayout',
        'receipt:preBillLayout',
        'receipt:updatePreBillLayout',
        'receipt:pickImage',
        'updater:status',
        'updater:check',
        'updater:download',
        'updater:install',
        'printing:printers',
        'printing:test',
        'printing:preview',
        'printing:testPrinter',
        'printers:create',
        'printers:update',
        'printers:setMain',
        'lan:status',
        'lan:update',
        'lan:pairingCode',
        'lan:cancelPairing',
        'lan:revoke',
        'halls:create',
        'halls:update',
        'halls:reorder',
        'halls:delete',
        'tables:create',
        'tables:createRange',
        'tables:update',
        'tables:delete',
      ],
      menu: [
        'categories:create',
        'categories:update',
        'categories:delete',
        'menu:create',
        'menu:update',
        'menu:delete',
        'menu:pickImage',
      ],
      shifts: [
        'printing:shiftReport',
        'sessions:cashSummary',
        'sessions:addCashMovement',
        'sessions:open',
        'sessions:update',
        'sessions:close',
        'residuals:apply',
      ],
      corrections: ['sessions:delete', 'checks:update', 'checks:delete'],
      orders: [
        'kitchen:failed',
        'kitchen:reprint',
        'orders:save',
        'orders:cancel',
        'orders:moveTable',
        'orders:lockTable',
        'orders:unlockTable',
        'orders:get',
        'orders:openList',
        'orders:saveOpen',
        'orders:cancelOpen',
        'orders:setDeliveryStatus',
        'customers:findByPhone',
      ],
      checks: ['orders:getByNumber', 'checks:list'],
      payments: ['payments:pay'],
      debt: ['debts:list', 'debts:get', 'debts:repay'],
      debtsAdmin: ['debts:writeOff', 'debts:void', 'debts:assign', 'customers:update'],
      reports: ['expenses:list', 'reports:sales', 'reports:staff'],
    });
  });

  it.each(
    Object.entries(HANDLERS)
      .filter(([, d]) => d.access !== 'public')
      .map(([c]) => c as IpcChannel),
  )('%s refuses a caller who is not logged in', async (channel) => {
    const result = await caller().call(channel, {});
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'NOT_AUTHENTICATED' }),
    });
  });

  it.each(
    Object.entries(HANDLERS)
      .filter(([, d]) => d.access !== 'public' && d.access !== 'user')
      .map(([c]) => c as IpcChannel),
  )('%s refuses a user without its permission', async (channel) => {
    const result = await caller(nobody).call(channel, {});
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });
});

describe('invokeHandler', () => {
  it('login stores the user on that caller only; logout clears it', async () => {
    const a = caller();
    const b = caller();
    expect(await a.call('auth:pinLogin', { pin: '2222' })).toMatchObject({
      ok: true,
      data: { fullName: 'staff', role: 'STAFF', permissions: ['orders'] },
    });
    expect(a.actor?.fullName).toBe('staff');
    expect(b.actor).toBeNull();
    expect((await a.call('orders:busyTables')).ok).toBe(true);
    await a.call('auth:logout');
    expect((await a.call('orders:busyTables')).ok).toBe(false);
  });

  it('cuts off a deactivated user on their next call', async () => {
    const victim = await createUser(t.db, { username: 'temp' });
    const c = caller(victim);
    expect((await c.call('orders:busyTables')).ok).toBe(true);
    await t.db.user.update({ where: { id: victim.id }, data: { isActive: false } });
    expect(await c.call('orders:busyTables')).toMatchObject({
      ok: false,
      error: { code: 'NOT_AUTHENTICATED' },
    });
    expect(c.actor).toBeNull();
  });

  it('a permission change takes effect without logging in again', async () => {
    const promoted = await createUser(t.db, { username: 'promoted' });
    const c = caller(promoted);
    expect((await c.call('users:list')).ok).toBe(false);
    await t.db.user.update({
      where: { id: promoted.id },
      data: { permissions: JSON.stringify(['orders', 'users']) },
    });
    expect((await c.call('users:list')).ok).toBe(true);
  });

  it('reports invalid input as VALIDATION with the failing paths, before running anything', async () => {
    const result = await caller(admin).call('menu:create', {
      nameUz: '',
      price: '-5',
      categoryId: 0,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const issues = (result as { error: { details: { issues: Array<{ path: string[] }> } } }).error
      .details.issues;
    expect(issues.map((i) => i.path[0]).sort()).toEqual(['categoryId', 'nameUz', 'price']);
  });

  it('hides unexpected errors from the renderer and logs them in main', async () => {
    const broken = {
      ...t.db,
      menuItem: { findMany: () => Promise.reject(new Error('disk on fire: C:\\secret\\path')) },
    };
    const result = await invokeHandler(
      'menu:list',
      HANDLERS['menu:list'] as never,
      {
        db: broken as never,
        actor: admin,
        setActor: () => undefined,
        terminal: 'test',
        services: {
          appInfo: () => ({ name: '', version: '', isPackaged: false }),
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
        },
        log: (m, e) => logged.push([m, e]),
      },
      {},
    );
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(logged.at(-1)?.[0]).toContain('menu:list');
  });

  it('logs a Prisma error without its query arguments (customer data)', async () => {
    const prismaError = Object.assign(
      new Error(
        [
          'Invalid `tx.customer.create()` invocation:',
          '',
          '{ data: { phone: "998901234567", address: "Chilonzor 9" } }',
        ].join(String.fromCharCode(10)),
      ),
      { name: 'PrismaClientValidationError' },
    );
    const broken = {
      ...t.db,
      menuItem: { findMany: () => Promise.reject(prismaError) },
    };
    await invokeHandler(
      'menu:list',
      HANDLERS['menu:list'] as never,
      {
        db: broken as never,
        actor: admin,
        setActor: () => undefined,
        terminal: 'test',
        services: {
          appInfo: () => ({ name: '', version: '', isPackaged: false }),
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
        },
        log: (m, e) => logged.push([m, e]),
      },
      {},
    );
    const entry = logged.at(-1)![1] as Error;
    expect(entry.message).toContain('PrismaClientValidationError');
    expect(entry.message).toContain('Invalid `tx.customer.create()` invocation');
    expect(`${entry.message} ${entry.stack}`).not.toMatch(/998901234567|Chilonzor/);
  });

  it('setup is public only until it has run', async () => {
    const t2 = await createTestDb();
    try {
      const c = {
        call: (channel: IpcChannel, input: unknown) =>
          invokeHandler(
            channel,
            HANDLERS[channel] as never,
            {
              db: t2.db,
              actor: null,
              setActor: () => undefined,
              terminal: 'test',
              services: {
                appInfo: () => ({ name: '', version: '', isPackaged: false }),
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
              },
              log: () => undefined,
            },
            input,
          ),
      };
      const wizard = {
        admin: { fullName: 'Ega', phone: '+998 90 000 00 01', pin: '1234' },
        receipt: { restaurantName: 'Oshxona' },
      };
      expect(await c.call('setup:complete', wizard)).toMatchObject({
        ok: true,
        data: { user: { role: 'ADMIN' }, recoveryCode: expect.any(String) },
      });
      expect(
        await c.call('setup:complete', {
          ...wizard,
          admin: { fullName: 'Evil', phone: '+998 90 000 00 02', pin: '6666' },
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT' },
      });
    } finally {
      await t2.close();
    }
  });

  it('app:info answers before login', async () => {
    expect(await caller().call('app:info')).toEqual({
      ok: true,
      data: { name: 'savdochef', version: '0.0.0-test', isPackaged: false },
    });
  });
});

describe('halls:list', () => {
  it('shows hidden halls to admins only', async () => {
    const hidden = await t.db.hall.create({ data: { name: 'Yashirin zal', isActive: false } });
    const names = async (who: Actor) => {
      const r = await caller(who).call('halls:list', { includeInactive: true });
      if (!r.ok) throw new Error(r.error.message);
      return r.data.map((h) => h.name);
    };
    expect(await names(admin)).toContain('Yashirin zal');
    expect(await names(staff)).not.toContain('Yashirin zal');
    await t.db.hall.delete({ where: { id: hidden.id } });
  });
});

/** A user as the main process sees them after login. */
const actorOf = async (id: number) =>
  toCurrentUser(await t.db.user.findUniqueOrThrow({ where: { id } }));

describe('users, PINs and permissions', () => {
  it('a user manager creates staff with a PIN; staff then log in with it; it can be removed', async () => {
    const boss = caller(admin);
    const created = await boss.call('users:create', {
      fullName: 'Ofitsiant',
      phone: '+998 91 222 33 44',
      pin: '2468',
    });
    expect(created).toMatchObject({
      ok: true,
      data: { fullName: 'Ofitsiant', role: 'STAFF', permissions: ['orders'], hasPin: true },
    });
    const id = created.ok ? created.data.id : 0;
    const window = caller();
    expect(await window.call('auth:pinLogin', { pin: '2468' })).toMatchObject({
      ok: true,
      data: { id },
    });
    // PINs and phones are unique (only a user manager ever sees this).
    expect(
      await boss.call('users:create', {
        fullName: 'Ikki',
        phone: '+998 91 222 33 45',
        pin: '2468',
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT', details: { field: 'pin' } } });
    expect(
      await boss.call('users:create', { fullName: 'Uch', phone: '+998 91 222 33 44' }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT', details: { field: 'phone' } } });

    expect(await caller(staff).call('users:update', { id, pin: '1357' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await boss.call('users:update', { id, pin: null })).toMatchObject({
      ok: true,
      data: { hasPin: false },
    });
    expect((await caller().call('auth:pinLogin', { pin: '2468' })).ok).toBe(false);
  });

  it('the role gives the defaults: cashier takes payments, staff does not; debt needs its own box', async () => {
    const boss = caller(admin);
    const cashier = await boss.call('users:create', {
      fullName: 'Kassir',
      phone: '+998 91 000 00 09',
      role: 'CASHIER',
    });
    expect(cashier).toMatchObject({
      ok: true,
      data: { permissions: ['orders', 'ordersOthers', 'payments', 'debt', 'checks', 'shifts'] },
    });
    const cashierId = cashier.ok ? cashier.data.id : 0;

    // Staff (orders only) cannot close an order; a cashier gets past the permission check.
    expect(
      await caller(staff).call('payments:pay', { orderId: 999, method: 'cash' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await caller(await actorOf(cashierId)).call('payments:pay', { orderId: 999, method: 'cash' }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    // Without the debt box, a cashier may not sell on debt.
    await boss.call('users:update', {
      id: cashierId,
      permissions: ['orders', 'payments', 'checks', 'shifts'],
    });
    expect(
      await caller(await actorOf(cashierId)).call('payments:pay', { orderId: 999, method: 'debt' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('the last user who manages users cannot lose it', async () => {
    const boss = caller(admin);
    // Only the admin manages users here (the user promoted in an earlier test is demoted).
    await t.db.user.updateMany({
      where: { id: { not: admin.id } },
      data: { permissions: JSON.stringify(['orders']) },
    });
    expect(
      await boss.call('users:update', { id: admin.id, permissions: ['orders'] }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(await boss.call('users:update', { id: admin.id, role: 'CASHIER' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });
});

describe('kitchen tickets (feature F11)', () => {
  it('a saved order hands its new tickets to the printer service; a refused one hands none', async () => {
    const printedBatches: number[][] = [];
    const ctx = (): HandlerContext => ({
      db: t.db,
      actor: admin,
      setActor: () => undefined,
      terminal: 'test',
      services: {
        appInfo: () => ({ name: 'savdochef', version: '0.0.0-test', isPackaged: false }),
        printer: {
          list: async () => [],
          print: async () => ({ printer: 'Test' }),
          preview: async () => '',
        },
        pickImage: async () => null,
        receiptImage: () => null,
        tableLocks: new TableLocks(),
        // Handlers hand over every outcome (empty on a refusal); only real batches count.
        printKitchen: (ids) => {
          if (ids.length) printedBatches.push(ids);
        },
        updater: unsupportedUpdater(),
        license: allowAllLicense(),
      },
      log: () => undefined,
    });
    const call = <C extends IpcChannel>(channel: C, input?: unknown) =>
      invokeHandler(channel, HANDLERS[channel] as never, ctx(), input);

    const printer = await call('printers:create', { label: 'Oshxona', windowsName: 'K-80' });
    if (!printer.ok) throw new Error(printer.error.message);
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    const dish = await call('menu:create', {
      nameUz: 'Kabob F11',
      price: '20000',
      categoryId,
      printerId: printer.data.id,
    });
    if (!dish.ok) throw new Error(dish.error.message);
    if (!(await t.db.session.findFirst({ where: { status: 'open' } }))) {
      const opened = await call('sessions:open', {
        items: [{ menuItemId: dish.data.id, initialQuantity: '10' }],
      });
      expect(opened.ok).toBe(true);
    } else {
      const open = await t.db.session.findFirstOrThrow({ where: { status: 'open' } });
      await t.db.sessionItem.create({
        data: { sessionId: open.id, menuItemId: dish.data.id, initialQuantity: '10' },
      });
    }

    const saved = await call('orders:save', {
      tableNumber: 9,
      lines: [{ menuItemId: dish.data.id, quantity: 2 }],
    });
    expect(saved.ok).toBe(true);
    expect(printedBatches).toHaveLength(1);
    const rows = await t.db.kitchenTicket.findMany({ where: { id: { in: printedBatches[0] } } });
    expect(rows.map((r) => [r.printerId, r.kind])).toEqual([[printer.data.id, 'NEW']]);

    // A stale save is refused before anything is written or printed.
    const refused = await call('orders:save', {
      tableNumber: 9,
      expectedVersion: 99,
      lines: [{ menuItemId: dish.data.id, quantity: 3 }],
    });
    expect(refused.ok).toBe(false);
    expect(printedBatches).toHaveLength(1);
  });
});

describe('one till per table, own orders only (feature F13)', () => {
  it('locks across tills, owner rule, admin take-over, logout; the pre-bill stays open to all', async () => {
    const waiter = caller(staff);
    const waiter2 = caller(await createUser(t.db, { username: 'staff2', role: 'STAFF' }));
    const boss = caller(admin);
    const ok = <T>(r: { ok: true; data: T } | { ok: false; error: { message: string } }): T => {
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    };
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    const dish = ok(
      await boss.call('menu:create', { nameUz: 'Lagmon F13', price: '30000', categoryId }),
    );
    const open = await t.db.session.findFirst({ where: { status: 'open' } });
    if (open) {
      await t.db.sessionItem.create({
        data: { sessionId: open.id, menuItemId: dish.id, initialQuantity: '10' },
      });
    } else {
      ok(
        await boss.call('sessions:open', {
          items: [{ menuItemId: dish.id, initialQuantity: '10' }],
        }),
      );
    }
    const busy = new Set(ok(await boss.call('orders:busyTables')).map((b) => b.tableNumber));
    const [table, other] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => !busy.has(n)) as [
      number,
      number,
    ];
    const lines = [{ menuItemId: dish.id, quantity: 1 }];
    const inUse = { ok: false, error: { code: 'CONFLICT', details: { reason: 'TABLE_IN_USE' } } };

    // The waiter's till opens the table; every other till is kept out of it.
    expect(await waiter.call('orders:lockTable', { tableNumber: table })).toEqual({
      ok: true,
      data: { held: true },
    });
    expect(await waiter2.call('orders:lockTable', { tableNumber: table })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { reason: 'TABLE_IN_USE', userName: 'staff' } },
    });
    expect(await waiter2.call('orders:save', { tableNumber: table, lines })).toMatchObject(inUse);
    const order = ok(await waiter.call('orders:save', { tableNumber: table, lines }));
    expect(
      await waiter2.call('orders:cancel', { tableNumber: table, expectedVersion: order.version }),
    ).toMatchObject(inUse);
    expect(ok(await waiter2.call('orders:tableLocks'))).toContainEqual({
      tableNumber: table,
      userName: 'staff',
      mine: false,
    });
    // Only an administrator takes a table over.
    expect(
      await waiter2.call('orders:lockTable', { tableNumber: table, force: true }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    // Released: another waiter may look (read-only, no lock) but not change it.
    ok(await waiter.call('orders:unlockTable', { tableNumber: table }));
    expect(await waiter2.call('orders:lockTable', { tableNumber: table })).toEqual({
      ok: true,
      data: { held: false },
    });
    const notOwner = { ok: false, error: { code: 'FORBIDDEN', details: { reason: 'NOT_OWNER' } } };
    expect(
      await waiter2.call('orders:save', {
        tableNumber: table,
        lines: [{ menuItemId: dish.id, quantity: 4 }],
        expectedVersion: order.version,
      }),
    ).toMatchObject(notOwner);
    expect(
      await waiter2.call('orders:cancel', { tableNumber: table, expectedVersion: order.version }),
    ).toMatchObject(notOwner);
    expect(
      await waiter2.call('orders:moveTable', {
        fromTable: table,
        toTable: other,
        expectedVersion: order.version,
      }),
    ).toMatchObject(notOwner);
    await t.db.receiptSettings.upsert({
      where: { id: 1 },
      create: { id: 1, restaurantName: 'Cafe' },
      update: {},
    });
    const preBill = await waiter2.call('printing:printPreBill', { orderId: order.id });
    expect(preBill.ok ? null : preBill.error).toBeNull();

    // The administrator takes over the waiter's open table; the waiter's till is then refused.
    ok(await waiter.call('orders:lockTable', { tableNumber: table }));
    expect(await boss.call('orders:lockTable', { tableNumber: table })).toMatchObject(inUse);
    expect(await boss.call('orders:lockTable', { tableNumber: table, force: true })).toEqual({
      ok: true,
      data: { held: true },
    });
    expect(
      await waiter.call('orders:save', {
        tableNumber: table,
        lines: [{ menuItemId: dish.id, quantity: 2 }],
        expectedVersion: order.version,
      }),
    ).toMatchObject(inUse);
    // A move frees the mover's lease; a logout frees everything the till held.
    const moved = ok(
      await boss.call('orders:moveTable', {
        fromTable: table,
        toTable: other,
        expectedVersion: order.version,
      }),
    );
    const held = ok(await waiter.call('orders:tableLocks')).map((l) => l.tableNumber);
    expect(held).not.toContain(table);
    expect(held).not.toContain(other);
    ok(await boss.call('orders:lockTable', { tableNumber: other }));
    expect(await waiter.call('orders:lockTable', { tableNumber: other })).toMatchObject(inUse);
    ok(await boss.call('auth:logout'));
    expect(ok(await waiter.call('orders:lockTable', { tableNumber: other }))).toEqual({
      held: true,
    });
    ok(await waiter.call('orders:cancel', { tableNumber: other, expectedVersion: moved.version }));
    ok(await waiter.call('orders:unlockTable', { tableNumber: other }));
  });
});

describe('F13 review: payment and takeaway/delivery through the handlers', () => {
  it('no payment while another till has the table open; open orders keep to their creator', async () => {
    const waiter = caller(staff);
    const waiter2 = caller(await createUser(t.db, { username: 'staff3', role: 'STAFF' }));
    const boss = caller(admin);
    const ok = <T>(r: { ok: true; data: T } | { ok: false; error: { message: string } }): T => {
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    };
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    const dish = ok(
      await boss.call('menu:create', { nameUz: 'Manti F13', price: '20000', categoryId }),
    );
    const open = await t.db.session.findFirstOrThrow({ where: { status: 'open' } });
    await t.db.sessionItem.create({
      data: { sessionId: open.id, menuItemId: dish.id, initialQuantity: '10' },
    });
    const lines = [{ menuItemId: dish.id, quantity: 1 }];
    const busy = new Set(ok(await boss.call('orders:busyTables')).map((b) => b.tableNumber));
    const table = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((n) => !busy.has(n))!;

    ok(await waiter.call('orders:lockTable', { tableNumber: table }));
    const order = ok(await waiter.call('orders:save', { tableNumber: table, lines }));
    expect(
      await boss.call('payments:pay', {
        orderId: order.id,
        method: 'cash',
        expectedVersion: order.version,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { reason: 'TABLE_IN_USE' } },
    });
    ok(await waiter.call('orders:unlockTable', { tableNumber: table }));
    expect(
      await boss.call('payments:pay', {
        orderId: order.id,
        method: 'cash',
        expectedVersion: order.version,
      }),
    ).toMatchObject({ ok: true, data: { status: 'completed' } });

    const notOwner = { ok: false, error: { code: 'FORBIDDEN', details: { reason: 'NOT_OWNER' } } };
    const takeaway = ok(await waiter.call('orders:saveOpen', { orderType: 'TAKEAWAY', lines }));
    expect(
      await waiter2.call('orders:saveOpen', {
        orderId: takeaway.id,
        orderType: 'TAKEAWAY',
        lines: [{ menuItemId: dish.id, quantity: 3 }],
        expectedVersion: takeaway.version,
      }),
    ).toMatchObject(notOwner);
    expect(
      await waiter2.call('orders:setDeliveryStatus', {
        orderId: takeaway.id,
        status: 'ON_THE_WAY',
        expectedVersion: takeaway.version,
      }),
    ).toMatchObject(notOwner);
    expect(
      await waiter2.call('orders:cancelOpen', {
        orderId: takeaway.id,
        expectedVersion: takeaway.version,
      }),
    ).toMatchObject(notOwner);
    ok(
      await waiter.call('orders:cancelOpen', {
        orderId: takeaway.id,
        expectedVersion: takeaway.version,
      }),
    );
  });
});
