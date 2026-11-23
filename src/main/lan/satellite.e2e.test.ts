import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { menuItemInput } from '@shared/schemas';
import type { AppEvent } from '@shared/ipc';
import type { LanLinkDto } from '@shared/types';
import type { Actor } from '../domain/db';
import type { HandlerServices } from '../ipc/ipc-safe';
import { createMenuItem } from '../menu/menu-items';
import { openSession } from '../sessions/sessions';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { allowAllLicense } from '../test-utils/license';
import { unsupportedUpdater } from '../test-utils/updater';
import { revokeDevice } from './devices';
import { MainLink, pairWithMain } from './main-link';
import { PairingStore } from './pairing';
import { LanServer } from './server';
import type { SatelliteLink } from './config';
import { TableLocks } from '../orders/table-locks';

/**
 * Feature F12 end to end: a real main till (LanServer over HTTP on a temporary database) and
 * satellites (MainLink) in one process, as posgro's satellite.e2e.test.ts.
 */

jest.setTimeout(60_000);

let t: TestDb;
let server: LanServer;
let base: string;
let imageDir: string;
const pairing = new PairingStore();
const kitchenBatches: number[][] = [];
const mainWindowEvents: AppEvent[] = [];
let limit: number | null = null;
let admin: Actor;
let dish: number;

const services: HandlerServices = {
  appInfo: () => ({ name: 'savdochef', version: '0.10.0', isPackaged: false }),
  printer: {
    list: async () => [],
    print: async () => ({ printer: 'Main' }),
    preview: async () => '',
  },
  pickImage: async () => null,
  receiptImage: () => null,
  // As register.ts: lock changes reach the main till's windows and every satellite.
  tableLocks: new TableLocks({
    onChange: (tables) => {
      const events = tables.map(
        (tableNumber): AppEvent => ({ type: 'orders-changed', tableNumber }),
      );
      mainWindowEvents.push(...events);
      server.push(events);
    },
  }),
  printKitchen: (ids) => {
    if (ids.length) kitchenBatches.push(ids);
  },
  updater: unsupportedUpdater(),
  license: allowAllLicense(),
};

const until = async (check: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

function satellite(link: SatelliteLink, version = '0.10.3') {
  const events: AppEvent[] = [];
  const states: LanLinkDto[] = [];
  const client = new MainLink({
    link,
    version,
    retryMs: [50, 100],
    onEvent: (e) => events.push(e),
    onState: (s) => states.push(s),
    log: () => undefined,
  });
  let session: string | null = null;
  const call = async (channel: Parameters<MainLink['rpc']>[0], input?: unknown) => {
    const out = await client.rpc(channel, input, session);
    if (out.session !== undefined) session = out.session;
    return out.result;
  };
  return { client, events, states, call, session: () => session };
}

async function pairNew(name = 'Kassa-2'): Promise<SatelliteLink> {
  const { code } = pairing.issue();
  return pairWithMain(base, code, name);
}

beforeAll(async () => {
  t = await createTestDb();
  imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'savdochef-lan-img-'));
  admin = await createUser(t.db, { username: 'Boss', role: 'ADMIN', pin: '1111' });
  await createUser(t.db, { username: 'Ofitsiant', role: 'STAFF', pin: '2222' });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  dish = (
    await createMenuItem(t.db, menuItemInput.parse({ nameUz: 'Osh', price: '25000', categoryId }))
  ).id;
  await openSession(t.db, admin, { items: [{ menuItemId: dish, initialQuantity: '50' }] });

  server = new LanServer({
    getDb: () => t.db,
    services,
    imageDir,
    version: '0.10.0',
    lineage: async () => 'lineage-A',
    pairing,
    deviceLimit: () => limit,
    waiterLimit: () => 0,
    restaurantName: async () => '',
    broadcastLocal: (events) => mainWindowEvents.push(...events),
    onPaired: () => undefined,
    log: () => undefined,
  });
  await server.start(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.stop();
  await t.close();
  fs.rmSync(imageDir, { recursive: true, force: true });
});

describe('pairing', () => {
  it('refuses without an open code and with a wrong one; a code works once', async () => {
    await expect(pairWithMain(base, '123456', 'x')).rejects.toThrow(/kodi ochilmagan/);
    const { code } = pairing.issue();
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(pairWithMain(base, wrong, 'x')).rejects.toThrow(/noto'g'ri/);
    const link = await pairWithMain(base, code, 'Kassa-2');
    expect(link).toMatchObject({ mainUrl: base, lineage: 'lineage-A', mainVersion: '0.10.0' });
    expect(link.secret).toMatch(/^[0-9a-f]{64}$/);
    await expect(pairWithMain(base, code, 'again')).rejects.toThrow(/kodi ochilmagan/);
    const row = await t.db.lanDevice.findUniqueOrThrow({ where: { id: link.deviceId } });
    expect(row.secretHash).not.toContain(link.secret);
  });

  it('respects the plan: no more satellites than it allows', async () => {
    limit = await t.db.lanDevice.count({ where: { revokedAt: null } });
    await expect(pairNew('one too many')).rejects.toThrow(/soni to'lgan/);
    limit = null;
  });
});

describe('a satellite at work', () => {
  let a: ReturnType<typeof satellite>;
  let b: ReturnType<typeof satellite>;

  beforeAll(async () => {
    a = satellite(await pairNew('A'));
    b = satellite(await pairNew('B'));
    a.client.start();
    b.client.start();
    await until(() => a.client.status().state === 'online' && b.client.status().state === 'online');
  });
  afterAll(() => {
    a.client.stop();
    b.client.stop();
  });

  it('signs in on the main till with a PIN; the session belongs to that satellite only', async () => {
    expect(await a.call('auth:me')).toEqual({ ok: true, data: null });
    const login = await a.call('auth:pinLogin', { pin: '2222' });
    expect(login).toMatchObject({ ok: true, data: { fullName: 'Ofitsiant', role: 'STAFF' } });
    expect(a.session()).toMatch(/^[0-9a-f]{64}$/);
    expect(await a.call('auth:me')).toMatchObject({ ok: true, data: { fullName: 'Ofitsiant' } });
    // B presenting A's session gets nobody.
    const stolen = await b.client.rpc('auth:me', undefined, a.session());
    expect(stolen.result).toEqual({ ok: true, data: null });
  });

  it("the main till's access rules apply: staff cannot change settings", async () => {
    const res = await a.call('settings:update', { language: 'ru' });
    expect(res).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('what belongs to the main till is refused over the LAN', async () => {
    expect(await a.call('menu:pickImage')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await a.call('lan:pairingCode')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('an order saved on a satellite: tickets print on the main till, everyone hears about it', async () => {
    a.events.length = 0;
    b.events.length = 0;
    const saved = await a.call('orders:save', {
      tableNumber: 3,
      lines: [{ menuItemId: dish, quantity: 2 }],
    });
    expect(saved).toMatchObject({ ok: true, data: { tableNumber: 3, createdBy: 'Ofitsiant' } });
    await until(() => b.events.some((e) => e.type === 'orders-changed'));
    expect(mainWindowEvents.some((e) => e.type === 'orders-changed')).toBe(true);
    const order = await t.db.order.findFirstOrThrow({ where: { pendingTable: 3 } });
    const sold = await t.db.sessionItem.findFirstOrThrow({ where: { menuItemId: dish } });
    expect(sold.soldQuantity.toString()).toBe('2');
    expect(order.totalAmount.toString()).toBe('50000');
  });

  it('two satellites on one table: one wins, the other is told the order changed', async () => {
    await b.call('auth:pinLogin', { pin: '1111' });
    const current = await a.call('orders:getTable', { tableNumber: 3 });
    if (!current.ok || !current.data) throw new Error('no order');
    const version = (current.data as { version: number }).version;
    const [r1, r2] = await Promise.all([
      a.call('orders:save', {
        tableNumber: 3,
        expectedVersion: version,
        lines: [{ menuItemId: dish, quantity: 3 }],
      }),
      b.call('orders:save', {
        tableNumber: 3,
        expectedVersion: version,
        lines: [{ menuItemId: dish, quantity: 4 }],
      }),
    ]);
    const oks = [r1, r2].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toMatchObject({
      error: { code: 'CONFLICT', details: { reason: 'STALE' } },
    });
  });

  it('F13: a table open on one till is closed to the others; a satellite gone frees it', async () => {
    const c = satellite(await pairNew('C'));
    c.client.start();
    await until(() => c.client.status().state === 'online');
    expect(await c.call('auth:pinLogin', { pin: '1111' })).toMatchObject({ ok: true });
    expect(await c.call('orders:lockTable', { tableNumber: 4 })).toEqual({
      ok: true,
      data: { held: true },
    });
    a.events.length = 0;
    expect(await a.call('orders:lockTable', { tableNumber: 4 })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { reason: 'TABLE_IN_USE', userName: 'Boss' } },
    });
    expect(
      await a.call('orders:save', { tableNumber: 4, lines: [{ menuItemId: dish, quantity: 1 }] }),
    ).toMatchObject({
      ok: false,
      error: { details: { reason: 'TABLE_IN_USE' } },
    });
    expect(await a.call('orders:tableLocks')).toEqual({
      ok: true,
      data: [{ tableNumber: 4, userName: 'Boss', mine: false }],
    });
    // C's line drops: the main till frees what it held and tells the others.
    c.client.stop();
    await until(() => a.events.some((e) => e.type === 'orders-changed' && e.tableNumber === 4));
    expect(await a.call('orders:tableLocks')).toEqual({ ok: true, data: [] });
    expect(await a.call('orders:lockTable', { tableNumber: 4 })).toEqual({
      ok: true,
      data: { held: true },
    });
    expect(await a.call('orders:unlockTable', { tableNumber: 4 })).toEqual({
      ok: true,
      data: null,
    });
  });

  it('a deactivated user is cut off on the next call; logout ends the session', async () => {
    const staff = await t.db.user.findFirstOrThrow({ where: { fullName: 'Ofitsiant' } });
    await t.db.user.update({ where: { id: staff.id }, data: { isActive: false } });
    expect(await a.call('orders:busyTables')).toMatchObject({
      ok: false,
      error: { code: 'NOT_AUTHENTICATED' },
    });
    expect(a.session()).toBeNull();
    await t.db.user.update({ where: { id: staff.id }, data: { isActive: true } });

    await b.call('auth:logout');
    expect(b.session()).toBeNull();
    expect(await b.call('auth:me')).toEqual({ ok: true, data: null });
  });

  it('pictures come from the main till', async () => {
    const name = `${'d'.repeat(32)}.png`;
    fs.writeFileSync(path.join(imageDir, name), Buffer.from('png-bytes'));
    expect((await a.client.image(name))?.toString()).toBe('png-bytes');
    expect(await a.client.image('../secret.png')).toBeNull();
  });

  it('a revoked satellite is unpaired at once', async () => {
    const id = (await t.db.lanDevice.findFirstOrThrow({ where: { name: 'B' } })).id;
    await revokeDevice(t.db, id);
    server.dropDevice(id);
    const res = await b.call('auth:me');
    expect(res).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(b.client.status().state).toBe('unpaired');
  });
});

describe('when the line is wrong', () => {
  it('refuses a main till of another version', async () => {
    const s = satellite(await pairNew('old'), '0.9.5');
    s.client.start();
    await until(() => s.client.status().state === 'version');
    expect(await s.call('auth:me')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    s.client.stop();
  });

  it('refuses a different main till at the address (another lineage)', async () => {
    const link = await pairNew('moved');
    const s = satellite({ ...link, lineage: 'lineage-B' });
    s.client.start();
    await until(() => s.client.status().state === 'superseded');
    s.client.stop();
  });

  it('a stopped main till is unreachable; the call says so instead of failing silently', async () => {
    const link = await pairNew('last');
    const s = satellite(link);
    s.client.start();
    await until(() => s.client.status().state === 'online');
    await server.stop();
    const res = await s.call('auth:me');
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { reason: 'MAIN_UNREACHABLE' } },
    });
    await until(() => s.client.status().state === 'unreachable');
    // Back on the same port: the satellite reconnects by itself.
    await server.start(Number(new URL(base).port), '127.0.0.1');
    await until(() => s.client.status().state === 'online', 10_000);
    s.client.stop();
  });
});

describe('who may call', () => {
  it('a caller without a device credential gets nothing but /health', async () => {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    // No lineage for strangers (it is what a satellite checks its main till by).
    expect(health).toEqual({ app: 'savdochef', version: '0.10.0' });
    expect((await fetch(`${base}/hello`)).status).toBe(401);
    const rpc = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'auth:me' }),
    });
    expect(rpc.status).toBe(401);
    const forged = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: {
        authorization: `SavdoChef 1.${'0'.repeat(64)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ channel: 'auth:me' }),
    });
    expect(forged.status).toBe(401);
  });

  it('a guessing satellite locks itself first, and parallel guesses do not slip past', async () => {
    const s = satellite(await pairNew('guesser'));
    const other = satellite(await pairNew('honest'));
    // Ten guesses at once: they run one by one; after three this satellite waits.
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => s.call('auth:pinLogin', { pin: '9999' })),
    );
    const codes = answers.map((a) => (a.ok ? 'ok' : a.error.code));
    expect(codes.filter((c) => c !== 'LOCKED')).toHaveLength(3);
    // The PIN pad of the other tills still works (the till-wide lock is not reached).
    expect(await other.call('auth:pinLogin', { pin: '1111' })).toMatchObject({ ok: true });
    for (let i = 0; i < 3; i++) await other.call('auth:pinLogin', { pin: '9998' });
    const fourth = await other.call('auth:pinLogin', { pin: '1111' });
    expect(fourth).toMatchObject({ ok: false, error: { code: 'LOCKED' } });
    // The till-wide lock (auth.ts `pin_lock`) still counts every failure too.
    expect(await t.db.setting.findUnique({ where: { key: 'pin_lock' } })).not.toBeNull();
  });
});
