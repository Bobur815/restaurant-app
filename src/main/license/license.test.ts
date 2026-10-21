import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { LICENSE_FEATURES } from '@shared/license';
import { receiptSettingsInput } from '@shared/schemas';
import { completeSetup } from '../settings/setup';
import { createTestDb, type TestDb } from '../test-utils/db';
import { DAY_MS, readLicense, refusal, tillState, type LicensePayload } from './license-core';
import { LicenseService, ServerError } from './license-service';
import { TrustedClock, type MarkStore } from './trusted-clock';

jest.setTimeout(60_000);

const NOW = Date.parse('2026-10-20T10:00:00Z');
const SERVER = generateKeyPairSync('ed25519');
const OTHER = generateKeyPairSync('ed25519');

function signed(payload: Partial<LicensePayload>, key: KeyObject = SERVER.privateKey): string {
  const full: LicensePayload = {
    v: 1,
    product: 'SAVDOCHEF',
    storeId: '1000',
    storeName: 'Shoxona',
    plan: 'TRIAL',
    expiresAt: new Date(NOW + 14 * DAY_MS).toISOString(),
    warnFrom: new Date(NOW + 11 * DAY_MS).toISOString(),
    blockAt: new Date(NOW + 17 * DAY_MS).toISOString(),
    issuedAt: new Date(NOW).toISOString(),
    checkinBy: new Date(NOW + 14 * DAY_MS).toISOString(),
    terminals: 1,
    seats: ['till-a'],
    features: [...LICENSE_FEATURES],
    ...payload,
  };
  const body = Buffer.from(JSON.stringify(full));
  return `${body.toString('base64url')}.${sign(null, body, key).toString('base64url')}`;
}

const state = (
  license: LicensePayload | null,
  now = NOW,
  extra: Partial<Parameters<typeof tillState>[0]> = {},
) =>
  tillState({
    license,
    setupComplete: true,
    firstRunAt: new Date(NOW),
    terminalId: 'till-a',
    now,
    ...extra,
  });
const read = (token: string) => readLicense(token, SERVER.publicKey);

describe('licence', () => {
  it('accepts only a SavdoChef licence signed with the compiled-in key', () => {
    expect(read(signed({}))?.storeId).toBe('1000');
    expect(read(signed({}, OTHER.privateKey))).toBeNull();
    expect(read(signed({ product: 'POSGRO' as never }))).toBeNull();
    const [body, sig] = signed({}).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), plan: 'VIP' }),
    );
    expect(read(`${forged.toString('base64url')}.${sig}`)).toBeNull();
    expect(read('garbage')).toBeNull();
    // Unknown feature names switch nothing on.
    expect(read(signed({ features: ['delivery', 'teleport' as never] }))?.features).toEqual([
      'delivery',
    ]);
  });

  it('walks trial -> warning -> grace -> read-only, and read-only once 14 days pass without a check-in', () => {
    const l = read(signed({}))!;
    expect(state(l)).toMatchObject({ mode: 'full', reason: 'trial', daysLeft: 14 });
    expect(state(l, NOW + 12 * DAY_MS)).toMatchObject({
      mode: 'full',
      reason: 'warning',
      daysLeft: 2,
    });
    const later = read(signed({ checkinBy: new Date(NOW + 30 * DAY_MS).toISOString() }))!;
    expect(state(later, NOW + 15 * DAY_MS)).toMatchObject({
      mode: 'full',
      reason: 'grace',
      daysLeft: 2,
    });
    expect(state(later, NOW + 17 * DAY_MS)).toMatchObject({ mode: 'readonly', reason: 'blocked' });
    const vip = read(signed({ plan: 'VIP', expiresAt: null, warnFrom: null, blockAt: null }))!;
    expect(state(vip, NOW + 13 * DAY_MS)).toMatchObject({ mode: 'full', reason: 'unlimited' });
    expect(state(vip, NOW + 14 * DAY_MS)).toMatchObject({
      mode: 'readonly',
      reason: 'checkin-required',
    });
  });

  it('puts a till without a slot in read-only', () => {
    expect(state(read(signed({}))!, NOW, { terminalId: 'till-b' })).toMatchObject({
      mode: 'readonly',
      reason: 'no-seat',
    });
  });

  it('lets a till set up before F5 run unlinked for 14 days, and a fresh install only finish setup by linking', () => {
    expect(state(null)).toMatchObject({ mode: 'full', reason: 'unlinked-allowance', daysLeft: 14 });
    expect(state(null, NOW + 14 * DAY_MS)).toMatchObject({ mode: 'readonly', reason: 'unlinked' });
    expect(state(null, NOW, { setupComplete: false })).toMatchObject({ mode: 'setup' });
  });

  it('refuses new business in read-only, keeps paying and closing open', async () => {
    const readonly = state(null, NOW + 20 * DAY_MS);
    const halls = async () => 1;
    for (const ch of ['orders:save', 'orders:saveOpen', 'sessions:open', 'menu:update'] as const) {
      expect(await refusal(ch, {}, readonly, halls)).toMatch(/ulanmagan/);
    }
    for (const ch of [
      'payments:pay',
      'sessions:close',
      'orders:cancel',
      'reports:sales',
      'license:checkNow',
      // A till blocked mid-shift still takes cash in/out and counts out (feature F6).
      'sessions:addCashMovement',
      'printing:shiftReport',
    ] as const) {
      expect(await refusal(ch, { start: 'a', end: 'a' }, readonly, halls)).toBeNull();
    }
    expect(
      await refusal('setup:complete', {}, state(null, NOW, { setupComplete: false }), halls),
    ).toMatch(/ulang/);
  });

  it('refuses what the plan does not include', async () => {
    const start = state(read(signed({ plan: 'STARTER', features: [] }))!);
    const halls = async () => 1;
    expect(await refusal('orders:saveOpen', { orderType: 'DELIVERY' }, start, halls)).toMatch(
      /Yetkazib/,
    );
    expect(await refusal('orders:saveOpen', { orderType: 'TAKEAWAY' }, start, halls)).toMatch(
      /Olib ketish/,
    );
    // An order that already exists can be finished.
    // Editing can change the type, so it is checked too.
    expect(await refusal('orders:saveOpen', { orderId: 5, orderType: 'DELIVERY' }, start, halls)).toMatch(/Yetkazib/);
    // Turning a paid check into debt is selling on debt.
    expect(
      await refusal('checks:update', { orderNumber: '2026-00001', tenders: [{ method: 'debt', amount: '5000' }] }, start, halls),
    ).toMatch(/Nasiya/);
    // A hidden hall switched back on is a second hall; the only hall switched on is not.
    expect(await refusal('halls:update', { id: 2, isActive: true }, start, async () => 1)).toMatch(/zal/);
    expect(await refusal('halls:update', { id: 2, isActive: true }, start, async () => 0)).toBeNull();
    expect(await refusal('halls:update', { id: 2, name: 'Zal' }, start, async () => 5)).toBeNull();
    expect(
      await refusal(
        'payments:pay',
        { tenders: [{ method: 'debt', amount: '1000' }] },
        start,
        halls,
      ),
    ).toMatch(/Nasiya/);
    expect(
      await refusal(
        'payments:pay',
        {
          tenders: [
            { method: 'cash', amount: '1000' },
            { method: 'debt', amount: '0' },
          ],
        },
        start,
        halls,
      ),
    ).toBeNull();
    expect(
      await refusal('reports:sales', { start: '2026-10-01', end: '2026-10-20' }, start, halls),
    ).toMatch(/hisobot/);
    expect(
      await refusal('reports:sales', { start: '2026-10-20', end: '2026-10-20' }, start, halls),
    ).toBeNull();
    expect(await refusal('halls:create', { name: 'Terrasa' }, start, halls)).toMatch(/zal/);
    expect(await refusal('halls:create', { name: 'Zal' }, start, async () => 0)).toBeNull();
    expect(
      await refusal(
        'receipt:updateLayout',
        { orderType: 'DINE_IN', topImage: 'a'.repeat(32) + '.png' },
        start,
        halls,
      ),
    ).toMatch(/rasm/);
    expect(
      await refusal('receipt:updateLayout', { orderType: 'DINE_IN', topImage: null }, start, halls),
    ).toBeNull();
  });
});

describe('trusted clock', () => {
  const memory = (initial: number | null = null): MarkStore & { value: number | null } => {
    const store = {
      value: initial,
      read: async () => store.value,
      write: async (ms: number) => {
        store.value = ms;
      },
    };
    return store;
  };

  it('cannot be wound back: by the system clock, or by deleting one copy of the mark', async () => {
    let system = NOW;
    let mono = 0;
    const a = memory();
    const b = memory();
    const clock = new TrustedClock([a, b], { now: () => system, monotonic: () => mono });
    await clock.init();
    mono += 5 * DAY_MS;
    system += 5 * DAY_MS;
    await clock.persist();
    system = NOW - 30 * DAY_MS; // wound back
    expect(clock.now()).toBe(NOW + 5 * DAY_MS);

    a.value = null; // one copy deleted
    const restarted = new TrustedClock([a, b], { now: () => system, monotonic: () => 0 });
    await restarted.init();
    expect(restarted.now()).toBe(NOW + 5 * DAY_MS);
    // A licence fresh from the server puts a clock that ran ahead right.
    await restarted.correctTo(NOW + 1 * DAY_MS);
    expect(restarted.now()).toBe(NOW + 1 * DAY_MS);
  });
});

describe('LicenseService', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  function service(post: jest.Mock, now = NOW) {
    const changes: number[] = [];
    const s = new LicenseService({
      db: t.db,
      publicKey: SERVER.publicKey,
      clock: new TrustedClock([], { now: () => now, monotonic: () => 0 }),
      http: { get: jest.fn(), post },
      appVersion: '0.6.0',
      machineName: 'KASSA-1',
      onChange: () => changes.push(1),
      log: { info: () => undefined, warn: () => undefined },
      minCheckIntervalMs: 0,
    });
    return { s, changes };
  }

  const grant = (terminalId: string, over: Partial<LicensePayload> = {}) => ({
    storeId: '1000',
    storeName: 'Shoxona',
    license: signed({ seats: [terminalId], ...over }),
    payment: { qrPayload: '', paymentUrl: 'https://pay/1000', supportPhone: '998901112233' },
  });

  it('links on sign-up, checks in, and keeps working offline when a check-in fails', async () => {
    const post = jest.fn();
    const { s, changes } = service(post);
    await s.init();
    expect((await s.status()).mode).toBe('setup');

    const { terminalId } = await s.status();
    post.mockResolvedValueOnce(grant(terminalId));
    const linked = await s.signupComplete({
      verificationId: 'v',
      code: '123456',
      restaurantName: 'Shoxona',
      ownerName: 'Vali',
    });
    expect(post).toHaveBeenLastCalledWith(
      '/savdochef/signup/complete',
      expect.objectContaining({
        terminal: { id: terminalId, appVersion: '0.6.0', machineName: 'KASSA-1' },
      }),
    );
    expect(linked).toMatchObject({
      linked: true,
      storeId: '1000',
      plan: 'TRIAL',
      payment: { supportPhone: '998901112233' },
    });
    expect(changes.length).toBe(1);

    await completeSetup(t.db, {
      admin: { fullName: 'Ega', phone: '998900000001', pin: '1234' },
      receipt: receiptSettingsInput.parse({ restaurantName: 'Shoxona' }),
      tableCount: 2,
    });
    expect((await s.status()).mode).toBe('full');

    post.mockRejectedValueOnce(new ServerError("Internetga ulanib bo'lmadi", 'OFFLINE'));
    const offline = await s.checkNow();
    expect(offline).toMatchObject({
      mode: 'full',
      linked: true,
      lastError: "Internetga ulanib bo'lmadi",
    });
    expect(post).toHaveBeenLastCalledWith(
      '/savdochef/licenses/renew',
      expect.objectContaining({ license: expect.any(String) }),
    );

    post.mockResolvedValueOnce(grant(terminalId, { plan: 'PRO', issuedAt: new Date(NOW + 60_000).toISOString() }));
    expect(await s.checkNow()).toMatchObject({ plan: 'PRO', lastError: null });
  });

  it('never goes back in time: an old licence played back is refused and the clock stays', async () => {
    const post = jest.fn();
    const { s } = service(post);
    await s.init();
    const { terminalId } = await s.status();
    const old = grant(terminalId, { issuedAt: new Date(NOW - 5 * DAY_MS).toISOString() });
    post.mockResolvedValueOnce(grant(terminalId));
    await s.activate({ phone: '998901234567', activationCode: 'ABCD-EF23' });
    // The token stays in main: nothing the renderer can ask for carries it.
    const token = (post.mock.results[0]!.value as Promise<{ license: string }>);
    expect(JSON.stringify(await s.status())).not.toContain((await token).license.split('.')[1]);

    post.mockResolvedValueOnce(old);
    const after = await s.checkNow();
    expect(after.lastError).toMatch(/eski/);
    // Still the newer licence: the trial counts from NOW, not from five days earlier.
    expect(after.daysLeft).toBe(14);
  });

  it('refuses a licence that was not signed by the server key', async () => {
    const post = jest
      .fn()
      .mockResolvedValue({ ...grant('x'), license: signed({}, OTHER.privateKey) });
    const { s } = service(post);
    await s.init();
    await expect(
      s.activate({ phone: '998901234567', activationCode: 'ABCD-EF23' }),
    ).rejects.toThrow(/yaroqsiz/);
    expect((await s.status()).linked).toBe(false);
  });

  it('keeps the same till id across restarts', async () => {
    const first = service(jest.fn()).s;
    await first.init();
    const id = (await first.status()).terminalId;
    const second = service(jest.fn()).s;
    await second.init();
    expect((await second.status()).terminalId).toBe(id);
  });
});
