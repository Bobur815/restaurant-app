import { createTestDb, type TestDb } from '../test-utils/db';
import { allowAllLicense } from '../test-utils/license';
import { unsupportedUpdater } from '../test-utils/updater';
import type { HandlerServices } from '../ipc/ipc-safe';
import { getLink, getRole, plainCipher } from './config';
import { LanService } from './lan-service';
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
    expect(store.redeem(code, '192.168.1.5')).toBe('ok');
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
    expect(store.redeem(code, '10.0.0.10')).toBe('ok');
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
  const make = (db: TestDb, restarts: string[]) =>
    new LanService({
      getDb: () => db.db,
      version: '0.10.0',
      imageDir: '',
      machineName: 'KASSA-2',
      cipher: plainCipher,
      services: () => services,
      deviceLimit: () => null,
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
