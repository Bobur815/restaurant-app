import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { IPC_CHANNELS, type AppEvent, type IpcChannel } from '@shared/ipc';
import { isWaiterChannel, WAITER_CHANNELS, WAITER_PROTOCOL } from '@shared/lan-waiter';
import { menuItemInput } from '@shared/schemas';
import type { Actor } from '../domain/db';
import type { HandlerServices } from '../ipc/ipc-safe';
import { createMenuItem } from '../menu/menu-items';
import { TableLocks } from '../orders/table-locks';
import { openSession } from '../sessions/sessions';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { allowAllLicense } from '../test-utils/license';
import { unsupportedUpdater } from '../test-utils/updater';
import { revokeDevice } from './devices';
import { PairingStore } from './pairing';
import { LanServer } from './server';

/**
 * Feature F20 end to end: a real main till (LanServer over HTTP on a temporary database) and a
 * waiter phone, played by plain HTTP calls as the phone app makes them. What matters most: a phone
 * reaches only WAITER_CHANNELS, whoever signs in on it, and only while the plan has room for it.
 */

jest.setTimeout(60_000);

let t: TestDb;
let server: LanServer;
let base: string;
let imageDir: string;
const pairing = new PairingStore();
let waiterLimit = 5;
let admin: Actor;
let dish: number;
const printed: string[] = [];

const services: HandlerServices = {
  appInfo: () => ({ name: 'savdochef', version: '0.13.0', isPackaged: false }),
  printer: {
    list: async () => [],
    print: async (_html, opts) => {
      printed.push(String((opts as { printerName?: string } | undefined)?.printerName ?? 'main'));
      return { printer: 'Main' };
    },
    preview: async () => '',
  },
  pickImage: async () => null,
  receiptImage: () => null,
  tableLocks: new TableLocks({
    onChange: (tables) =>
      server.push(tables.map((tableNumber): AppEvent => ({ type: 'orders-changed', tableNumber }))),
  }),
  printKitchen: () => undefined,
  updater: unsupportedUpdater(),
  license: allowAllLicense(),
};

interface Phone {
  deviceId: number;
  secret: string;
  session: string | null;
}

async function pairPhone(name = 'Aziz telefoni'): Promise<Phone> {
  const { code } = pairing.issue('waiter');
  const res = await fetch(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // As the phone app pairs: it says it is a phone.
    body: JSON.stringify({ code, name, expect: 'waiter' }),
  });
  const body = (await res.json()) as { deviceId: number; secret: string; kind?: string };
  expect(res.status).toBe(200);
  expect(body.kind).toBe('waiter');
  return { deviceId: body.deviceId, secret: body.secret, session: null };
}

const auth = (p: Phone) => ({
  authorization: `SavdoChef ${p.deviceId}.${p.secret}`,
  'content-type': 'application/json',
  ...(p.session ? { 'x-session': p.session } : {}),
});

async function call(p: Phone, channel: IpcChannel | string, input?: unknown) {
  const res = await fetch(`${base}/rpc`, {
    method: 'POST',
    headers: auth(p),
    body: JSON.stringify({ channel, input }),
  });
  const body = (await res.json()) as {
    result?: { ok: boolean; data?: unknown; error?: { code: string; message: string } };
    session?: string | null;
    error?: unknown;
  };
  if (body.session !== undefined) p.session = body.session;
  return { status: res.status, ...body };
}

/** The phone's event stream: frames as they arrive, until `stop()`. */
function listen(p: Phone) {
  const events: AppEvent[] = [];
  let buffer = '';
  const req = http.get(`${base}/events`, { headers: auth(p) }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)) as AppEvent);
      }
    });
  });
  req.on('error', () => undefined);
  return { events, stop: () => req.destroy() };
}

const until = async (check: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const PHONE_REFUSAL = 'Bu amal telefondan bajarilmaydi: kassada bajaring';

beforeAll(async () => {
  t = await createTestDb();
  imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'savdochef-waiter-img-'));
  admin = await createUser(t.db, { username: 'Boss', role: 'ADMIN', pin: '1111' });
  await createUser(t.db, { username: 'Ofitsiant', role: 'STAFF', pin: '2222' });
  await t.db.receiptSettings.upsert({
    where: { id: 1 },
    update: { restaurantName: 'Shoxona' },
    create: { id: 1, restaurantName: 'Shoxona' },
  });
  const categoryId = (await t.db.category.findFirstOrThrow()).id;
  dish = (
    await createMenuItem(
      t.db,
      menuItemInput.parse({ nameUz: 'Osh', price: '25000', costPrice: '11000', categoryId }),
    )
  ).id;
  await openSession(t.db, admin, {
    items: [{ menuItemId: dish, initialQuantity: '50' }],
    openingCash: '300000',
  });

  server = new LanServer({
    getDb: () => t.db,
    services,
    imageDir,
    version: '0.13.0',
    lineage: async () => 'lineage-A',
    pairing,
    deviceLimit: () => null,
    waiterLimit: () => waiterLimit,
    restaurantName: async () => (await t.db.receiptSettings.findFirst())?.restaurantName ?? '',
    broadcastLocal: () => undefined,
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

describe('pairing a phone (F20)', () => {
  it('the kind comes from the code: a phone code makes a phone, a till code a till', async () => {
    const phone = await pairPhone();
    const { code } = pairing.issue();
    const till = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A till code with a caller pretending to be a phone stays a till.
      body: JSON.stringify({ code, name: 'Kassa-2', kind: 'waiter' }),
    });
    const tillId = ((await till.json()) as { deviceId: number }).deviceId;
    const rows = await t.db.lanDevice.findMany({ orderBy: { id: 'asc' } });
    expect(rows.find((r) => r.id === phone.deviceId)?.kind).toBe('waiter');
    expect(rows.find((r) => r.id === tillId)?.kind).toBe('till');
    await revokeDevice(t.db, tillId);
    await revokeDevice(t.db, phone.deviceId);
  });

  it('a plan without the waiter app pairs no phone', async () => {
    waiterLimit = 0;
    const { code } = pairing.issue('waiter');
    const res = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'x' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toMatch(/ofitsiant ilovasi yo'q/);
    expect(body.reason).toBe('plan');
    // F20-W review: refused before the code is used up; with the plan back, it still works.
    expect(pairing.current()?.code).toBe(code);
    waiterLimit = 5;
    pairing.cancel();
  });

  it('a refused code says why, for the phone to show the right card (F20-W)', async () => {
    const pairWith = async (code: string) => {
      const res = await fetch(`${base}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name: 'x', expect: 'waiter' }),
      });
      return { status: res.status, body: (await res.json()) as { reason?: string } };
    };
    pairing.cancel();
    expect(await pairWith('123456')).toMatchObject({ status: 403, body: { reason: 'expired' } });
    const { code } = pairing.issue('waiter');
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await pairWith(wrong)).toMatchObject({ status: 403, body: { reason: 'wrong' } });
    pairing.cancel();
    pairing.issue('till');
    const tillCode = pairing.current()!.code;
    expect(await pairWith(tillCode)).toMatchObject({ status: 403, body: { reason: 'kind' } });
    pairing.cancel();
  });

  it('/hello tells the phone the protocol and the restaurant name', async () => {
    const phone = await pairPhone();
    const res = await fetch(`${base}/hello`, { headers: auth(phone) });
    expect(await res.json()).toEqual({
      lineage: 'lineage-A',
      version: '0.13.0',
      protocol: WAITER_PROTOCOL,
      restaurantName: 'Shoxona',
    });
    await revokeDevice(t.db, phone.deviceId);
  });
});

describe('what a phone may do (F20)', () => {
  let phone: Phone;

  beforeAll(async () => {
    phone = await pairPhone();
    // An administrator's PIN on the phone: still only the sale channels.
    const login = await call(phone, 'auth:pinLogin', { pin: '1111' });
    expect(login.result?.ok).toBe(true);
  });

  it('shows a phone no cost price, printer, fiscal codes or cash drawer (F20-W)', async () => {
    const menu = (await call(phone, 'menu:list', {})).result?.data as Array<
      Record<string, unknown>
    >;
    const osh = menu.find((m) => m['id'] === dish)!;
    expect(osh).toMatchObject({ price: '25000', costPrice: null, printerId: null, mxik: null });
    // An allowlist: a field added to MenuItemDto later does not reach phones until listed here.
    expect(Object.keys(osh).sort()).toEqual(
      [
        'categoryId',
        'categoryNameUz',
        'costPrice',
        'description',
        'hasPortions',
        'id',
        'imageFile',
        'isActive',
        'mxik',
        'nameRu',
        'nameUz',
        'packageCode',
        'price',
        'printerId',
        'soldByWeight',
      ].sort(),
    );
    const shift = (await call(phone, 'sessions:getOpen')).result?.data as Record<string, unknown>;
    expect(shift).toMatchObject({ openingCash: null, countedCash: null, expectedCash: null });
    expect((shift['items'] as unknown[]).length).toBeGreaterThan(0);
    // The till itself (and a satellite) still sees them.
    const own = await t.db.menuItem.findUniqueOrThrow({ where: { id: dish } });
    expect(own.costPrice?.toString()).toBe('11000');
  });

  it('every channel outside the waiter list is refused, even for an admin', async () => {
    const refused = IPC_CHANNELS.filter((c) => !isWaiterChannel(c));
    expect(refused).toEqual(
      expect.arrayContaining(['payments:pay', 'users:list', 'settings:update']),
    );
    for (const channel of refused) {
      const out = await call(phone, channel, {});
      expect({ channel, result: out.result }).toEqual({
        channel,
        result: { ok: false, error: { code: 'FORBIDDEN', message: PHONE_REFUSAL } },
      });
    }
  });

  it('every channel on the list reaches its handler', async () => {
    for (const channel of WAITER_CHANNELS) {
      if (channel === 'auth:logout' || channel === 'auth:pinLogin') continue;
      const out = await call(phone, channel, undefined);
      expect({ channel, message: out.result?.error?.message }).not.toEqual({
        channel,
        message: PHONE_REFUSAL,
      });
    }
  });

  it('takes an order, prints the pre-bill on the main till, and sells nothing on its own', async () => {
    const saved = await call(phone, 'orders:save', {
      tableNumber: 5,
      lines: [{ menuItemId: dish, quantity: 2 }],
    });
    expect(saved.result).toMatchObject({ ok: true, data: { tableNumber: 5 } });
    const order = saved.result!.data as { id: number };
    const bill = await call(phone, 'printing:printPreBill', { orderId: order.id });
    expect(bill.result).toMatchObject({ ok: true });
    const pay = await call(phone, 'payments:pay', { orderId: order.id });
    expect(pay.result?.error?.message).toBe(PHONE_REFUSAL);
    const row = await t.db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('pending');
    const sold = await t.db.sessionItem.findFirstOrThrow({ where: { menuItemId: dish } });
    expect(sold.soldQuantity.toString()).toBe('2');
  });

  it('hears orders and menu changes, never users, debts, kitchen, updates or the LAN', async () => {
    const stream = listen(phone);
    try {
      await new Promise((r) => setTimeout(r, 200));
      server.push([
        { type: 'users-changed' },
        { type: 'debts-changed' },
        { type: 'kitchen-changed' },
        { type: 'update-changed' },
        { type: 'lan-changed' },
        { type: 'menu-changed' },
        { type: 'orders-changed', tableNumber: 5 },
      ]);
      await until(() => stream.events.length >= 2);
      await new Promise((r) => setTimeout(r, 100));
      expect(stream.events).toEqual([
        { type: 'menu-changed' },
        { type: 'orders-changed', tableNumber: 5 },
      ]);
    } finally {
      stream.stop();
    }
  });
});

describe("the owner's slips and the phone's narrower rights (F20 review)", () => {
  const pair = (code: string, expect: string) =>
    fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'x', expect }),
    });

  it('a till code typed on a phone is refused and stays open; a phone code on a till too', async () => {
    const { code } = pairing.issue('till');
    const phone = await pair(code, 'waiter');
    expect(phone.status).toBe(403);
    expect(JSON.stringify(await phone.json())).toMatch(/kassa uchun/);
    expect(pairing.current()?.code).toBe(code);

    const waiterCode = pairing.issue('waiter').code;
    const till = await pair(waiterCode, 'till');
    expect(till.status).toBe(403);
    expect(JSON.stringify(await till.json())).toMatch(/telefon uchun/);
    expect(pairing.current()?.code).toBe(waiterCode);
    pairing.cancel();
  });

  it('a phone never forces a table away from a till, even with an admin PIN', async () => {
    const phone = await pairPhone('Force');
    await call(phone, 'auth:pinLogin', { pin: '1111' });
    services.tableLocks.take(9, { terminal: 'main', userId: 99, userName: 'Kassir' });
    const out = await call(phone, 'orders:lockTable', { tableNumber: 9, force: true });
    expect(out.result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    services.tableLocks.releaseTerminal('main');
    await revokeDevice(t.db, phone.deviceId);
  });

  it('a phone prints the pre-bill of an open table order only', async () => {
    const phone = await pairPhone('Bill');
    await call(phone, 'auth:pinLogin', { pin: '1111' });
    const saved = await call(phone, 'orders:save', {
      tableNumber: 6,
      lines: [{ menuItemId: dish, quantity: 1 }],
    });
    const id = (saved.result!.data as { id: number }).id;
    expect((await call(phone, 'printing:printPreBill', { orderId: id })).result?.ok).toBe(true);
    await t.db.order.update({ where: { id }, data: { status: 'completed', pendingTable: null } });
    const paid = await call(phone, 'printing:printPreBill', { orderId: id });
    expect(paid.result?.error?.message).toMatch(/faqat ochiq stol/);
    await revokeDevice(t.db, phone.deviceId);
  });

  it('a lowered plan ends the event stream of the phones beyond it', async () => {
    const active = await t.db.lanDevice.findMany({ where: { revokedAt: null, kind: 'waiter' } });
    for (const d of active) await revokeDevice(t.db, d.id);
    const first = await pairPhone('A');
    const second = await pairPhone('B');
    let ended = false;
    const req = http.get(`${base}/events`, { headers: auth(second) }, (res) => {
      res.on('data', () => undefined);
      res.on('end', () => (ended = true));
    });
    req.on('error', () => undefined);
    await new Promise((r) => setTimeout(r, 200));
    waiterLimit = 1;
    server.push([{ type: 'license-changed' }]);
    await until(() => ended);
    req.destroy();
    waiterLimit = 5;
    await revokeDevice(t.db, first.deviceId);
    await revokeDevice(t.db, second.deviceId);
  });
});

describe('the plan limit and unpairing (F20)', () => {
  it('only the first phones within the limit work; unpairing one lets the next in', async () => {
    const active = await t.db.lanDevice.findMany({ where: { revokedAt: null, kind: 'waiter' } });
    for (const d of active) await revokeDevice(t.db, d.id);
    waiterLimit = 1;
    const first = await pairPhone('Birinchi');
    // Pairing a second is refused while the first holds the only slot.
    const { code } = pairing.issue('waiter');
    const res = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'Ikkinchi' }),
    });
    expect(res.status).toBe(409);

    // The plan is raised, a second phone pairs, then lowered again: the newer one stops.
    waiterLimit = 2;
    const second = await pairPhone('Ikkinchi');
    waiterLimit = 1;
    expect((await call(first, 'auth:pinLogin', { pin: '2222' })).result?.ok).toBe(true);
    const refused = await call(second, 'auth:pinLogin', { pin: '2222' });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.error)).toMatch(/telefonlar soni tugagan/);

    await revokeDevice(t.db, first.deviceId);
    server.dropDevice(first.deviceId);
    expect((await call(second, 'auth:pinLogin', { pin: '2222' })).result?.ok).toBe(true);
    // The unpaired phone is not known any more.
    expect((await call(first, 'auth:me')).status).toBe(401);
    waiterLimit = 5;
  });
});
