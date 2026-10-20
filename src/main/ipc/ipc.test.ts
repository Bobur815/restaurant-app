import type { IpcChannel } from '@shared/ipc';
import type { Actor } from '../domain/db';
import { toCurrentUser } from '../auth/auth';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { unsupportedUpdater } from '../test-utils/updater';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext } from './ipc-safe';

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

/** A fake window: holds its own login like register.ts does per webContents. */
function caller(initial: Actor | null = null) {
  let actor = initial;
  const ctx = (): HandlerContext => ({
    db: t.db,
    actor,
    setActor: (a) => {
      actor = a;
    },
    services: {
      appInfo: () => ({ name: 'savdochef', version: '0.0.0-test', isPackaged: false }),
      printer: {
        list: async () => [],
        print: async () => ({ printer: 'Test' }),
        preview: async () => 'data:image/png;base64,',
      },
      pickImage: async () => null,
      receiptImage: () => null,
      updater: unsupportedUpdater(),
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
      ],
      user: [
        'users:updateProfile',
        'printing:printReceipt',
        'halls:list',
        'categories:list',
        'menu:list',
        'menu:get',
        'sessions:getOpen',
        'sessions:get',
        'sessions:list',
        'sessions:pendingCarry',
        'orders:busyTables',
        'orders:getTable',
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
        'receipt:pickImage',
        'updater:status',
        'updater:check',
        'updater:download',
        'updater:install',
        'printing:printers',
        'printing:test',
        'printing:preview',
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
      shifts: ['sessions:open', 'sessions:update', 'sessions:close', 'residuals:apply'],
      corrections: ['sessions:delete', 'checks:update', 'checks:delete'],
      orders: [
        'orders:save',
        'orders:cancel',
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
      reports: ['expenses:list', 'reports:sales'],
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
        services: {
          appInfo: () => ({ name: '', version: '', isPackaged: false }),
          printer: {
            list: async () => [],
            print: async () => ({ printer: 'Test' }),
            preview: async () => 'data:image/png;base64,',
          },
          pickImage: async () => null,
          receiptImage: () => null,
          updater: unsupportedUpdater(),
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
        services: {
          appInfo: () => ({ name: '', version: '', isPackaged: false }),
          printer: {
            list: async () => [],
            print: async () => ({ printer: 'Test' }),
            preview: async () => 'data:image/png;base64,',
          },
          pickImage: async () => null,
          receiptImage: () => null,
          updater: unsupportedUpdater(),
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
              services: {
                appInfo: () => ({ name: '', version: '', isPackaged: false }),
                printer: {
                  list: async () => [],
                  print: async () => ({ printer: 'Test' }),
                  preview: async () => 'data:image/png;base64,',
                },
                pickImage: async () => null,
                receiptImage: () => null,
                updater: unsupportedUpdater(),
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
      data: { permissions: ['orders', 'payments', 'debt', 'checks', 'shifts'] },
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
