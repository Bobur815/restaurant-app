import bcrypt from 'bcryptjs';
import { receiptSettingsInput, setupInput } from '@shared/schemas';
import { completeSetup } from '../settings/setup';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import {
  bootstrapPin,
  bootstrapStatus,
  LOCK_MINUTES,
  MAX_FAILED,
  pinLogin,
  recoverWithCode,
  setPinOf,
} from './auth';

jest.setTimeout(60_000);

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

const minutes = (from: Date, n: number) => new Date(from.getTime() + n * 60_000);

async function setup(pin = '1234') {
  return completeSetup(
    t.db,
    setupInput.parse({
      admin: { fullName: 'Ega', phone: '+998 90 000 00 01', pin },
      receipt: receiptSettingsInput.parse({ restaurantName: 'Test' }),
    }),
  );
}

describe('PIN login', () => {
  it('the PIN alone says who logs in; it is stored as a keyed hash, never as digits', async () => {
    const { user: admin } = await setup('1234');
    const waiter = await createUser(t.db, { username: 'Dilshod', pin: '5678' });

    expect(await pinLogin(t.db, '1234')).toMatchObject({ id: admin.id, role: 'ADMIN' });
    expect(await pinLogin(t.db, '5678')).toMatchObject({
      id: waiter.id,
      fullName: 'Dilshod',
      permissions: ['orders'],
    });
    const row = await t.db.user.findUniqueOrThrow({ where: { id: waiter.id } });
    expect(row.pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('5678');
  });

  it('PINs are unique', async () => {
    await setup('1234');
    const waiter = await createUser(t.db, { username: 'Dilshod' });
    await expect(setPinOf(t.db, waiter.id, '1234')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { field: 'pin' },
    });
  });

  it('5 wrong PINs lock the keypad; the lock doubles and survives a restart', async () => {
    await setup('1234');
    const now = new Date(2026, 9, 20, 10, 0);
    for (let i = 1; i < MAX_FAILED; i++) {
      await expect(pinLogin(t.db, '0000', now)).rejects.toMatchObject({
        code: 'NOT_AUTHENTICATED',
        details: { attemptsLeft: MAX_FAILED - i },
      });
    }
    await expect(pinLogin(t.db, '0000', now)).rejects.toMatchObject({ code: 'LOCKED' });
    // Locked even for the right PIN (the lock is kept in the database, not in memory).
    await expect(pinLogin(t.db, '1234', minutes(now, 1))).rejects.toMatchObject({
      code: 'LOCKED',
    });

    const later = minutes(now, LOCK_MINUTES + 1);
    for (let i = 0; i < MAX_FAILED - 1; i++)
      await expect(pinLogin(t.db, '0000', later)).rejects.toThrow();
    const second = await pinLogin(t.db, '0000', later).catch((e: unknown) => e);
    expect(second).toMatchObject({ code: 'LOCKED' });
    const until = new Date((second as { details: { lockedUntil: string } }).details.lockedUntil);
    expect(until.getTime() - later.getTime()).toBe(2 * LOCK_MINUTES * 60_000);

    // A right PIN after the lock resets everything.
    expect((await pinLogin(t.db, '1234', minutes(until, 1))).fullName).toBe('Ega');
    await expect(pinLogin(t.db, '0000', minutes(until, 1))).rejects.toMatchObject({
      details: { attemptsLeft: MAX_FAILED - 1 },
    });
  });

  it('an inactive user is refused even with the right PIN', async () => {
    await setup();
    await createUser(t.db, { username: 'Ketgan', pin: '4444', isActive: false });
    await expect(pinLogin(t.db, '4444')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a PIN from the old version works once and is converted', async () => {
    await setup();
    const old = await createUser(t.db, { username: 'Eski' });
    await t.db.user.update({
      where: { id: old.id },
      data: { legacyPinCode: await bcrypt.hash('2468', 4) },
    });
    expect((await pinLogin(t.db, '2468')).id).toBe(old.id);
    const row = await t.db.user.findUniqueOrThrow({ where: { id: old.id } });
    expect(row).toMatchObject({ legacyPinCode: null });
    expect(row.pinHash).not.toBeNull();
    expect((await pinLogin(t.db, '2468')).id).toBe(old.id);

    // Two old PINs alike: nobody gets in on it, an administrator must give new ones.
    const hash = await bcrypt.hash('1357', 4);
    for (const name of ['A', 'B']) {
      const u = await createUser(t.db, { username: name });
      await t.db.user.update({ where: { id: u.id }, data: { legacyPinCode: hash } });
    }
    await expect(pinLogin(t.db, '1357')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('recovery code', () => {
  it('setup gives a code once; it sets the owner a new PIN and is replaced by a new code', async () => {
    const { recoveryCode } = await setup('1234');
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(JSON.stringify(await t.db.setting.findMany())).not.toContain(recoveryCode);

    await expect(
      recoverWithCode(t.db, { code: 'AAAA-BBBB-CCCC', pin: '9999' }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
    // Typed in lower case without dashes still matches.
    const result = await recoverWithCode(t.db, {
      code: recoveryCode.toLowerCase().replace(/-/g, ''),
      pin: '9999',
    });
    expect(result.user.fullName).toBe('Ega');
    expect(result.recoveryCode).not.toBe(recoveryCode);
    expect((await pinLogin(t.db, '9999')).fullName).toBe('Ega');
    await expect(pinLogin(t.db, '1234')).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
    await expect(recoverWithCode(t.db, { code: recoveryCode, pin: '8888' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
  });
});

describe('first administrator PIN', () => {
  it('only while nobody who manages users can log in', async () => {
    const owner = await createUser(t.db, { username: 'Ega', role: 'ADMIN' });
    await createUser(t.db, { username: 'Kassa', role: 'CASHIER', pin: '1111' });
    expect(await bootstrapStatus(t.db)).toEqual({
      needed: true,
      admins: [{ id: owner.id, fullName: 'Ega' }],
    });
    const cashier = (await t.db.user.findFirstOrThrow({ where: { fullName: 'Kassa' } })).id;
    await expect(bootstrapPin(t.db, { userId: cashier, pin: '2222' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const result = await bootstrapPin(t.db, { userId: owner.id, pin: '2222' });
    expect(result.user.id).toBe(owner.id);
    expect(result.recoveryCode).toMatch(/^[A-Z2-9-]{14}$/);
    expect(await bootstrapStatus(t.db)).toEqual({ needed: false, admins: [] });
    await expect(bootstrapPin(t.db, { userId: owner.id, pin: '3333' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
