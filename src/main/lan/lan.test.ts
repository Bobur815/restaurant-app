import http from 'node:http';
import type { AppEvent } from '@shared/ipc';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { allowAllLicense } from '../test-utils/license';
import { unsupportedUpdater } from '../test-utils/updater';
import type { HandlerServices } from '../ipc/ipc-safe';
import {
  countActiveDevices,
  createDevice,
  kindOf,
  listDevices,
  waiterWithinLimit,
} from './devices';
import { getLink, getRole, plainCipher } from './config';
import { LanService, PRESENCE_DEBOUNCE_MS } from './lan-service';
import { CODE_TTL_MS, hashSecret, PairingStore, secretMatches } from './pairing';
import {
  isLocalAddress,
  normaliseMainAddress,
  shouldServe,
  versionsCompatible,
} from './serve-policy';
import { TableLocks } from '../orders/table-locks';

jest.setTimeout(60_000);

describe('pairing codes (F12)', () => {
  it('six digits, single use, expire after ten minutes', () => {
    let now = 1_000;
    const store = new PairingStore(() => now);
    const { code } = store.issue();
    expect(code).toMatch(/^\d{6}$/);
    expect(store.redeem(code, '192.168.1.5')).toEqual({ kind: 'till' });
    expect(store.redeem(code, '192.168.1.5')).toBe('closed');
    store.issue();
    now += CODE_TTL_MS + 1;
    expect(store.isOpen()).toBe(false);
  });

  it('throttles an address after five wrong codes, even for the right one', () => {
    const store = new PairingStore();
    const { code } = store.issue();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(store.redeem(wrong, '10.0.0.9')).toBe('wrong');
    expect(store.redeem(code, '10.0.0.9')).toBe('throttled');
    // Another address is not punished for it.
    expect(store.redeem(code, '10.0.0.10')).toEqual({ kind: 'till' });
  });

  it('ten wrong codes in all, from any addresses, cancel the code', () => {
    const store = new PairingStore();
    const { code } = store.issue();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 10; i++) expect(store.redeem(wrong, `10.0.1.${i}`)).toBe('wrong');
    expect(store.burned).toBe(true);
    expect(store.redeem(code, '10.0.2.1')).toBe('closed');
  });

  it('keeps only a hash of the device secret', () => {
    const h = hashSecret('a'.repeat(64));
    expect(h).not.toContain('a'.repeat(64));
    expect(secretMatches('a'.repeat(64), h)).toBe(true);
    expect(secretMatches('b'.repeat(64), h)).toBe(false);
  });
});

describe('serve policy and addresses (F12)', () => {
  it('serves only a main till that has satellites switched on and a satellite or an open code', () => {
    const base = { role: 'main' as const, enabled: true, activeDevices: 0, pairingOpen: false };
    expect(shouldServe(base)).toBe(false);
    expect(shouldServe({ ...base, pairingOpen: true })).toBe(true);
    expect(shouldServe({ ...base, activeDevices: 2 })).toBe(true);
    expect(shouldServe({ ...base, activeDevices: 2, enabled: false })).toBe(false);
    expect(shouldServe({ ...base, activeDevices: 2, role: 'satellite' })).toBe(false);
  });

  it('only the shop network and this machine may call', () => {
    for (const a of [
      '192.168.1.20',
      '10.1.2.3',
      '172.20.0.5',
      '127.0.0.1',
      '::1',
      '::ffff:192.168.0.2',
    ])
      expect(isLocalAddress(a)).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '100.64.1.1', '', undefined])
      expect(isLocalAddress(a)).toBe(false);
  });

  it('reads the address the way it is typed, refuses public ones', () => {
    expect(normaliseMainAddress('192.168.1.10', 5180)).toBe('http://192.168.1.10:5180');
    expect(normaliseMainAddress(' http://192.168.1.10:6000/ ', 5180)).toBe(
      'http://192.168.1.10:6000',
    );
    expect(normaliseMainAddress('8.8.8.8', 5180)).toBeNull();
    expect(normaliseMainAddress('192.168.1.300', 5180)).toBeNull();
    expect(normaliseMainAddress('evil.example.com', 5180)).toBeNull();
    // Below 1024 (not a port a main till listens on), this machine (installed builds).
    expect(normaliseMainAddress('192.168.1.10:80', 5180)).toBeNull();
    expect(normaliseMainAddress('127.0.0.1:5180', 5180)).toBeNull();
    expect(normaliseMainAddress('localhost', 5180)).toBeNull();
    expect(normaliseMainAddress('127.0.0.1:5180', 5180, true)).toBe('http://127.0.0.1:5180');
  });

  it('two tills talk when major.minor match', () => {
    expect(versionsCompatible('0.10.0', '0.10.7')).toBe(true);
    expect(versionsCompatible('0.10.0', '0.11.0')).toBe(false);
  });
});

describe('LanService (F12)', () => {
  let main: TestDb;
  let sat: TestDb;
  const services: HandlerServices = {
    appInfo: () => ({ name: 'savdochef', version: '0.10.0', isPackaged: false }),
    printer: {
      list: async () => [],
      print: async () => ({ printer: 'x' }),
      preview: async () => '',
    },
    pickImage: async () => null,
    receiptImage: () => null,
    tableLocks: new TableLocks(),
    updater: unsupportedUpdater(),
    license: allowAllLicense(),
  };
  const make = (db: TestDb, restarts: string[], version = '0.10.0') =>
    new LanService({
      getDb: () => db.db,
      version,
      imageDir: '',
      machineName: 'KASSA-2',
      cipher: plainCipher,
      services: () => services,
      deviceLimit: () => null,
      waiterLimit: () => 0,
      broadcastLocal: () => undefined,
      restart: () => restarts.push('restart'),
      log: () => undefined,
      allowLoopback: true,
    });

  beforeAll(async () => {
    main = await createTestDb();
    sat = await createTestDb();
  });
  afterAll(async () => {
    await main.close();
    await sat.close();
  });

  it('a main till listens only while it should; a satellite joins with the code and restarts', async () => {
    const restarts: string[] = [];
    const m = make(main, restarts);
    await m.init();
    // A free port for this run.
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    await m.update({ port });
    expect((await m.status()).serving).toBe(false); // switched off

    await expect(m.issueCode()).rejects.toMatchObject({ code: 'CONFLICT' });
    await m.update({ enabled: true });
    expect((await m.status()).serving).toBe(false); // on, but nobody to serve
    const withCode = await m.issueCode();
    expect(withCode.serving).toBe(true);
    expect(withCode.pairing?.code).toMatch(/^\d{6}$/);

    const satRestarts: string[] = [];
    const s = make(sat, satRestarts);
    await s.init();
    await expect(s.join({ mainAddress: '8.8.8.8', code: '123456' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const joined = await s.join({ mainAddress: `127.0.0.1:${port}`, code: withCode.pairing!.code });
    expect(joined).toMatchObject({ role: 'satellite', mainUrl: `http://127.0.0.1:${port}` });
    expect(satRestarts).toEqual(['restart']);
    expect(await getRole(sat.db)).toBe('satellite');
    expect(await getLink(sat.db, plainCipher)).toMatchObject({ deviceId: expect.any(Number) });

    // The code is spent; the paired satellite keeps the server up.
    const after = await m.status();
    expect(after.pairing).toBeNull();
    expect(after.devices).toHaveLength(1);
    expect(after.serving).toBe(true);

    // Revoked: nobody left to serve, the port closes.
    const revoked = await m.revoke(after.devices[0]!.id);
    expect(revoked.serving).toBe(false);
    expect(revoked.devices[0]!.revoked).toBe(true);

    // The satellite (after its restart) leaves and is a till of its own again.
    const again = make(sat, satRestarts);
    await again.init();
    expect(again.isSatellite).toBe(true);
    await again.leave();
    expect(await getRole(sat.db)).toBe('main');
    expect(await getLink(sat.db, plainCipher)).toBeNull();
    await again.stop();
    await s.stop();
    await m.stop();
  });

  it('F15: a satellite updates itself unattended only while its main till is the newer one', async () => {
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
    };
    const pair = async (mainVersion: string, satVersion: string) => {
      const m = make(main, [], mainVersion);
      await m.init();
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      await m.update({ port, enabled: true });
      const code = (await m.issueCode()).pairing!.code;
      const db = await createTestDb();
      const first = make(db, [], satVersion);
      await first.init();
      await first.join({ mainAddress: `127.0.0.1:${port}`, code });
      await first.stop();
      // After its restart the satellite follows the main till and compares versions.
      const s = make(db, [], satVersion);
      await s.init();
      await until(() => ['online', 'version'].includes(s.linkStatus().state ?? ''));
      const result = {
        state: s.linkStatus().state,
        mainVersion: s.mainVersion,
        mayUpdate: s.mayUpdateUnattended,
      };
      await s.stop();
      await m.stop();
      await db.close();
      return result;
    };
    expect(await pair('0.11.0', '0.10.3')).toEqual({
      state: 'version',
      mainVersion: '0.11.0',
      mayUpdate: true,
    });
    // The satellite is the newer one: the main till has to be updated, not this one.
    expect(await pair('0.9.0', '0.10.0')).toMatchObject({ state: 'version', mayUpdate: false });
    // Same series: working, nothing unattended.
    expect(await pair('0.10.1', '0.10.0')).toMatchObject({ state: 'online', mayUpdate: false });
  });

  it('F15 review: a stranger at the main till address claiming a newer version unlocks nothing', async () => {
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
    };
    const m = make(main, [], '0.10.0');
    await m.init();
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    await m.update({ port, enabled: true });
    const code = (await m.issueCode()).pairing!.code;
    const db = await createTestDb();
    const first = make(db, [], '0.10.0');
    await first.init();
    await first.join({ mainAddress: `127.0.0.1:${port}`, code });
    await first.stop();
    await m.stop();

    // Another restaurant's till (another lineage) now answers at that address, "newer".
    const strangerDb = await createTestDb();
    const stranger = make(strangerDb, [], '0.11.0');
    await stranger.init();
    await stranger.update({ port, enabled: true });
    await stranger.issueCode(); // serving
    const s = make(db, [], '0.10.0');
    await s.init();
    await until(() => !['connecting', 'unreachable'].includes(s.linkStatus().state ?? ''));
    // It does not know this satellite (401): "unpaired", as before F15, and its version is not
    // believed, so the update stays closed.
    expect(s.linkStatus().state).toBe('unpaired');
    expect(s.linkStatus().mainVersion).not.toBe('0.11.0');
    expect(s.mayUpdateUnattended).toBe(false);
    await s.stop();
    await stranger.stop();
    await db.close();
    await strangerDb.close();
  });

  it('an unattended re-pair reaches only the same restaurant', async () => {
    const restarts: string[] = [];
    const m = make(main, restarts);
    await m.init();
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    await m.update({ port, enabled: true });
    const other = await createTestDb();
    try {
      // `other` was paired with a different restaurant before (its stored lineage differs).
      await other.db.setting.create({
        data: {
          key: 'lan_link',
          value: JSON.stringify({
            mainUrl: 'http://192.168.1.99:5180',
            deviceId: 1,
            secret: { enc: 'plain', v: 'x'.repeat(64) },
            lineage: 'another-restaurant',
            mainVersion: '0.10.0',
          }),
        },
      });
      await other.db.setting.create({ data: { key: 'lan_role', value: '"satellite"' } });
      const s = make(other, []);
      const { pairing } = await m.issueCode();
      await expect(
        s.join({ mainAddress: `127.0.0.1:${port}`, code: pairing!.code }, { sameRestaurant: true }),
      ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'OTHER_RESTAURANT' } });
      expect(await getRole(other.db)).toBe('satellite');
      expect((await getLink(other.db, plainCipher))?.lineage).toBe('another-restaurant');
    } finally {
      await other.close();
      await m.stop();
    }
  });

  it('a credential that cannot be read shows "unpaired", never a silent till of its own', async () => {
    const db = await createTestDb();
    try {
      await db.db.setting.create({
        data: {
          key: 'lan_link',
          value: JSON.stringify({
            mainUrl: 'http://192.168.1.50:5180',
            deviceId: 3,
            secret: { enc: 'dpapi', v: 'AAAA' },
            lineage: 'L',
            mainVersion: '0.10.0',
          }),
        },
      });
      await db.db.setting.create({ data: { key: 'lan_role', value: '"satellite"' } });
      const s = make(db, []); // plainCipher: cannot open a DPAPI value
      await s.init();
      expect(s.isSatellite).toBe(true);
      expect(s.linkStatus()).toMatchObject({
        role: 'satellite',
        state: 'unpaired',
        mainUrl: 'http://192.168.1.50:5180',
      });
      expect(s.mayRejoinUnattended).toBe(true);
      expect(s.mayLeaveUnattended).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('a main till refuses the satellite-only and a satellite the main-only actions', async () => {
    const m = make(main, []);
    await m.init();
    await expect(m.leave()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(m.linkStatus()).toMatchObject({ role: 'main', state: null });
    await m.stop();
  });
});

describe('waiter phones and tills apart (F20)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it('a code remembers what it pairs', () => {
    const store = new PairingStore();
    const { code } = store.issue('waiter');
    expect(store.current()?.kind).toBe('waiter');
    expect(store.redeem(code, '10.0.0.1')).toEqual({ kind: 'waiter' });
  });

  it('counts phones and tills against their own limits', async () => {
    await createDevice(t.db, 'Kassa-2', null, 1, 'till');
    await createDevice(t.db, 'Tel-1', null, 2, 'waiter');
    await createDevice(t.db, 'Tel-2', null, 2, 'waiter');
    await expect(createDevice(t.db, 'Tel-3', null, 2, 'waiter')).rejects.toMatchObject({
      message: "Tarifingiz bo'yicha telefonlar soni to'lgan",
    });
    await expect(createDevice(t.db, 'Kassa-3', null, 1, 'till')).rejects.toMatchObject({
      message: "Tarifingiz bo'yicha qo'shimcha kassalar soni to'lgan",
    });
    expect(await countActiveDevices(t.db, 'waiter')).toBe(2);
    expect(await countActiveDevices(t.db, 'till')).toBe(1);
    expect(await countActiveDevices(t.db)).toBe(3);
    expect((await listDevices(t.db)).map((d) => [d.name, d.kind])).toEqual([
      ['Kassa-2', 'till'],
      ['Tel-1', 'waiter'],
      ['Tel-2', 'waiter'],
    ]);
  });

  it('an unknown stored kind is read as the narrower one (a phone)', () => {
    expect(kindOf('till')).toBe('till');
    expect(kindOf('waiter')).toBe('waiter');
    expect(kindOf('tablet')).toBe('waiter');
  });

  it('the earliest phones within the limit work; none on a plan without the app', async () => {
    const phones = await t.db.lanDevice.findMany({
      where: { kind: 'waiter' },
      orderBy: { id: 'asc' },
    });
    expect(await waiterWithinLimit(t.db, phones[0]!.id, 1)).toBe(true);
    expect(await waiterWithinLimit(t.db, phones[1]!.id, 1)).toBe(false);
    expect(await waiterWithinLimit(t.db, phones[1]!.id, 2)).toBe(true);
    expect(await waiterWithinLimit(t.db, phones[0]!.id, 0)).toBe(false);
  });
});

describe('who is online, for the settings page (F20-T)', () => {
  let t: TestDb;
  let svc: LanService;
  let base: string;
  const local: AppEvent[] = [];
  const services: HandlerServices = {
    appInfo: () => ({ name: 'savdochef', version: '0.13.0', isPackaged: false }),
    printer: {
      list: async () => [],
      print: async () => ({ printer: 'x' }),
      preview: async () => '',
    },
    pickImage: async () => null,
    receiptImage: () => null,
    tableLocks: new TableLocks(),
    updater: unsupportedUpdater(),
    license: allowAllLicense(),
  };

  beforeAll(async () => {
    t = await createTestDb();
    await createUser(t.db, { username: 'Dilshod', role: 'STAFF', pin: '2222' });
    svc = new LanService({
      getDb: () => t.db,
      version: '0.13.0',
      imageDir: '',
      machineName: 'KASSA-1',
      cipher: plainCipher,
      services: () => services,
      deviceLimit: () => null,
      waiterLimit: () => 5,
      broadcastLocal: (events) => local.push(...events),
      restart: () => undefined,
      log: () => undefined,
    });
    await svc.init();
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    await svc.update({ port, enabled: true });
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await svc.stop();
    await t.close();
  });

  const pair = async (kind: 'till' | 'waiter', name: string) => {
    const code = (await svc.issueCode(kind)).pairing!.code;
    const res = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name, expect: kind }),
    });
    const body = (await res.json()) as { deviceId: number; secret: string };
    return { ...body, session: null as string | null };
  };
  const headers = (d: { deviceId: number; secret: string; session: string | null }) => ({
    authorization: `SavdoChef ${d.deviceId}.${d.secret}`,
    'content-type': 'application/json',
    ...(d.session ? { 'x-session': d.session } : {}),
  });
  const rpc = async (d: Awaited<ReturnType<typeof pair>>, channel: string, input?: unknown) => {
    const res = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: headers(d),
      body: JSON.stringify({ channel, input }),
    });
    const body = (await res.json()) as { session?: string | null };
    if (body.session !== undefined) d.session = body.session;
  };
  const stream = (d: Awaited<ReturnType<typeof pair>>) => {
    const req = http.get(`${base}/events`, { headers: headers(d) });
    req.on('error', () => undefined);
    return () => req.destroy();
  };
  const device = async (id: number) => (await svc.status()).devices.find((x) => x.id === id)!;
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 25));
    expect(await check()).toBe(true);
  };

  it('a phone is online while its stream is open, with the name of who signed in on it', async () => {
    const phone = await pair('waiter', 'Samsung Galaxy A15');
    expect(await device(phone.deviceId)).toMatchObject({ online: false, userName: null });

    const close = stream(phone);
    await until(async () => (await device(phone.deviceId)).online);
    expect((await device(phone.deviceId)).userName).toBeNull();

    await rpc(phone, 'auth:pinLogin', { pin: '2222' });
    expect((await device(phone.deviceId)).userName).toBe('Dilshod');
    await rpc(phone, 'auth:logout');
    expect((await device(phone.deviceId)).userName).toBeNull();

    await rpc(phone, 'auth:pinLogin', { pin: '2222' });
    close();
    await until(async () => !(await device(phone.deviceId)).online);
    // Offline: no name, even though the session is still remembered.
    expect((await device(phone.deviceId)).userName).toBeNull();
  });

  it('a till shows online but never a user name; unpairing takes it offline', async () => {
    const till = await pair('till', 'Bar kassasi');
    const close = stream(till);
    await rpc(till, 'auth:pinLogin', { pin: '2222' });
    await until(async () => (await device(till.deviceId)).online);
    expect((await device(till.deviceId)).userName).toBeNull();

    await svc.revoke(till.deviceId);
    expect(await device(till.deviceId)).toMatchObject({ revoked: true, online: false });
    close();
  });

  it('a device name loses bidi overrides and zero-width marks', async () => {
    const d = await pair('waiter', '\u202eKassa\u200b-2\u2066');
    expect((await device(d.deviceId)).name).toBe('Kassa-2');
  });

  it('a new sign-in replaces the older session of that device (no stale user after a restart)', async () => {
    await createUser(t.db, { username: 'Malika', role: 'STAFF', pin: '3333' });
    const phone = await pair('waiter', 'Tel');
    const close = stream(phone);
    await rpc(phone, 'auth:pinLogin', { pin: '2222' });
    const old = phone.session;
    // The app restarted: no token, Malika signs in.
    phone.session = null;
    await rpc(phone, 'auth:pinLogin', { pin: '3333' });
    await until(async () => (await device(phone.deviceId)).userName === 'Malika');
    // Dilshod's old token is gone.
    const res = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: headers({ ...phone, session: old }),
      body: JSON.stringify({ channel: 'auth:me' }),
    });
    expect(((await res.json()) as { session?: string | null }).session).toBeNull();
    close();
  });

  it('a burst of presence changes reaches the page as one lan-changed', async () => {
    const phone = await pair('waiter', 'Redmi Note 12');
    await new Promise((r) => setTimeout(r, PRESENCE_DEBOUNCE_MS + 200));
    local.length = 0;
    const close = stream(phone);
    await rpc(phone, 'auth:pinLogin', { pin: '2222' });
    await rpc(phone, 'auth:logout');
    await new Promise((r) => setTimeout(r, PRESENCE_DEBOUNCE_MS + 300));
    expect(local.filter((e) => e.type === 'lan-changed')).toHaveLength(1);
    close();
  });
});

describe('a till is on the shop network (F20-W review)', () => {
  it('accepts private IPv4 only, in the QR as well', async () => {
    const { isPrivateIPv4, waiterPairingQr } = await import('@shared/lan-waiter');
    expect(
      ['10.0.0.5', '172.16.1.2', '172.31.255.1', '192.168.1.10', '169.254.3.4'].every(
        isPrivateIPv4,
      ),
    ).toBe(true);
    expect(
      ['8.8.8.8', '172.32.0.1', '100.64.0.1', '127.0.0.1', '192.168.1.300', 'kassa'].some(
        isPrivateIPv4,
      ),
    ).toBe(false);
    const qr = { app: 'savdochef-waiter', v: 1, port: 5180, code: '123456' };
    expect(waiterPairingQr.safeParse({ ...qr, hosts: ['192.168.1.10'] }).success).toBe(true);
    expect(
      waiterPairingQr.safeParse({ ...qr, hosts: ['192.168.1.10', '203.0.113.7'] }).success,
    ).toBe(false);
  });
});
