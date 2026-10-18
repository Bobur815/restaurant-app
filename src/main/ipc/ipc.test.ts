import type { IpcChannel } from '@shared/ipc';
import type { Actor } from '../domain/db';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext } from './ipc-safe';

jest.setTimeout(60_000);

let t: TestDb;
let admin: Actor;
let staff: Actor;
const logged: Array<[string, unknown]> = [];

beforeAll(async () => {
  t = await createTestDb();
  admin = await createUser(t.db, { username: 'admin', role: 'ADMIN', password: 'admin-pass' });
  staff = await createUser(t.db, { username: 'staff', role: 'STAFF', password: 'staff-pass' });
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
      pickImage: async () => null,
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
    const byAccess: Record<string, string[]> = { public: [], user: [], admin: [] };
    for (const [channel, def] of Object.entries(HANDLERS)) byAccess[def.access]!.push(channel);
    expect(byAccess).toEqual({
      public: [
        'app:info',
        'auth:login',
        'auth:logout',
        'auth:me',
        'auth:pinUsers',
        'auth:pinLogin',
        'setup:status',
        'setup:complete',
        'settings:get',
        'receipt:get',
      ],
      user: [
        'auth:changePassword',
        'auth:pinStatus',
        'auth:setPin',
        'users:updateProfile',
        'categories:list',
        'menu:list',
        'menu:get',
        'sessions:getOpen',
        'sessions:get',
        'sessions:list',
        'sessions:pendingCarry',
        'sessions:open',
        'sessions:update',
        'sessions:close',
        'orders:busyTables',
        'orders:getTable',
        'orders:getByNumber',
        'orders:save',
        'orders:cancel',
        'payments:pay',
        'checks:list',
        'residuals:list',
        'residuals:apply',
      ],
      admin: [
        'users:list',
        'users:create',
        'users:update',
        'users:resetPassword',
        'settings:update',
        'receipt:update',
        'categories:create',
        'categories:update',
        'categories:delete',
        'menu:create',
        'menu:update',
        'menu:delete',
        'menu:pickImage',
        'sessions:delete',
        'checks:update',
        'checks:delete',
        'expenses:list',
        'reports:sales',
      ],
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
      .filter(([, d]) => d.access === 'admin')
      .map(([c]) => c as IpcChannel),
  )('%s refuses STAFF', async (channel) => {
    const result = await caller(staff).call(channel, {});
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });
});

describe('invokeHandler', () => {
  it('login stores the user on that caller only; logout clears it', async () => {
    const a = caller();
    const b = caller();
    expect(await a.call('auth:login', { username: 'staff', password: 'staff-pass' })).toMatchObject(
      {
        ok: true,
        data: { username: 'staff', role: 'STAFF' },
      },
    );
    expect(a.actor?.username).toBe('staff');
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

  it('a role change takes effect without logging in again', async () => {
    const promoted = await createUser(t.db, { username: 'promoted' });
    const c = caller(promoted);
    expect((await c.call('users:list')).ok).toBe(false);
    await t.db.user.update({ where: { id: promoted.id }, data: { role: 'ADMIN' } });
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
          pickImage: async () => null,
        },
        log: (m, e) => logged.push([m, e]),
      },
      {},
    );
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(logged.at(-1)?.[0]).toContain('menu:list');
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
                pickImage: async () => null,
              },
              log: () => undefined,
            },
            input,
          ),
      };
      const wizard = {
        admin: { username: 'owner', password: 'owner-pass' },
        receipt: { restaurantName: 'Oshxona' },
      };
      expect(await c.call('setup:complete', wizard)).toMatchObject({
        ok: true,
        data: { role: 'ADMIN' },
      });
      expect(
        await c.call('setup:complete', {
          ...wizard,
          admin: { username: 'evil', password: 'evil-pass' },
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
