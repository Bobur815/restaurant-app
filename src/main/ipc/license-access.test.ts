import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { allowAllLicense } from '../test-utils/license';
import { unsupportedUpdater } from '../test-utils/updater';
import type { Actor } from '../domain/db';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext } from './ipc-safe';

jest.setTimeout(60_000);

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

function ctx(
  actor: Actor | null,
  setupMode: boolean,
  refusal: string | null = null,
): HandlerContext {
  const license = {
    ...allowAllLicense(),
    isLinked: () => !setupMode,
    isSetupMode: async () => setupMode,
    refusal: async () => refusal,
  };
  return {
    db: t.db,
    actor,
    setActor: () => undefined,
    services: {
      appInfo: () => ({ name: 'x', version: '0', isPackaged: false }),
      printer: {
        list: async () => [],
        print: async () => ({ printer: 'x' }),
        preview: async () => '',
      },
      pickImage: async () => null,
      receiptImage: () => null,
      updater: unsupportedUpdater(),
      license,
    },
    log: () => undefined,
  };
}

const plans = (c: HandlerContext) =>
  invokeHandler('license:plans', HANDLERS['license:plans'], c, undefined);

describe('licence channels', () => {
  it('let anyone link during first setup (no user exists yet)', async () => {
    expect(await plans(ctx(null, true))).toMatchObject({ ok: true });
  });

  it('need a user with the settings permission once the till is set up, linked or not', async () => {
    const staff = await createUser(t.db, { username: 'k', role: 'STAFF', pin: '2468' });
    const admin = await createUser(t.db, { username: 'a', role: 'ADMIN', pin: '1357' });
    expect(await plans(ctx(null, false))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await plans(ctx(staff, false))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await plans(ctx(admin, false))).toMatchObject({ ok: true });

    // The lock screen and cashiers learn where the till stands, not its ids, bill or pay details,
    // whether they ask for the status or for a check-in.
    for (const ch of ['license:status', 'license:checkNow'] as const) {
      const call = (a: Actor | null) => invokeHandler(ch, HANDLERS[ch], ctx(a, false), undefined);
      const hidden = {
        terminalId: '',
        storeId: null,
        payment: null,
        account: null,
        lastError: null,
      };
      expect(await call(null)).toMatchObject({ ok: true, data: { mode: 'full', ...hidden } });
      expect(await call(staff)).toMatchObject({ ok: true, data: hidden });
      expect(await call(admin)).toMatchObject({
        ok: true,
        data: {
          terminalId: 'test-till',
          storeId: '1000',
          account: { owed: '75000' },
          payment: { qrPayload: 'QR' },
        },
      });
    }
  });

  it('refuse a call the licence does not allow, with its Uzbek reason, before the handler runs', async () => {
    const admin = await createUser(t.db, { username: 'b', role: 'ADMIN', pin: '9753' });
    const result = await invokeHandler(
      'sessions:open',
      HANDLERS['sessions:open'],
      ctx(admin, false, 'Obuna muddati tugagan'),
      { items: [{ menuItemId: 1, initialQuantity: '1' }] },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'Obuna muddati tugagan', details: { reason: 'LICENSE' } },
    });
  });
});
