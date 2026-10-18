import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import {
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  listPinUsers,
  login,
  pinLogin,
  pinStatus,
  setPin,
} from './auth';

jest.setTimeout(30_000);

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe('lock-screen PIN', () => {
  it('needs the account password to set, and stores a hash, never the digits', async () => {
    const actor = await createUser(t.db, { username: 'pin1', password: 'pass-1234' });
    await expect(
      setPin(t.db, actor, { currentPassword: 'wrong', pin: '1234' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(await setPin(t.db, actor, { currentPassword: 'pass-1234', pin: '1234' })).toEqual({
      hasPin: true,
    });
    const row = await t.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(row.pinCode).toMatch(/^\$2[aby]\$/);
    expect(row.pinCode).not.toContain('1234');
    expect(await pinStatus(t.db, actor)).toEqual({ hasPin: true });
  });

  it('unlocks with the right PIN and refuses a wrong one', async () => {
    const actor = await createUser(t.db, { username: 'pin2', password: 'pass-1234' });
    await setPin(t.db, actor, { currentPassword: 'pass-1234', pin: '0707' });
    await expect(pinLogin(t.db, { userId: actor.id, pin: '0707' })).resolves.toMatchObject({
      username: 'pin2',
    });
    await expect(pinLogin(t.db, { userId: actor.id, pin: '7070' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
  });

  it('shares the lock with password login: 5 wrong PINs lock the password too', async () => {
    const actor = await createUser(t.db, { username: 'pin3', password: 'pass-1234' });
    await setPin(t.db, actor, { currentPassword: 'pass-1234', pin: '4321' });
    const now = new Date('2026-10-19T10:00:00Z');
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await pinLogin(t.db, { userId: actor.id, pin: '0000' }, now).catch(() => undefined);
    }
    await expect(pinLogin(t.db, { userId: actor.id, pin: '4321' }, now)).rejects.toMatchObject({
      code: 'LOCKED',
    });
    await expect(
      login(t.db, { username: 'pin3', password: 'pass-1234' }, now),
    ).rejects.toMatchObject({
      code: 'LOCKED',
    });
    const later = new Date(now.getTime() + LOCK_MINUTES * 60_000 + 1);
    await expect(pinLogin(t.db, { userId: actor.id, pin: '4321' }, later)).resolves.toBeTruthy();
  });

  it('a user without a PIN, an unknown user or an inactive one cannot unlock', async () => {
    const noPin = await createUser(t.db, { username: 'pin4' });
    await expect(pinLogin(t.db, { userId: noPin.id, pin: '1111' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
    await expect(pinLogin(t.db, { userId: 999_999, pin: '1111' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });

    const gone = await createUser(t.db, { username: 'pin5', password: 'pass-1234' });
    await setPin(t.db, gone, { currentPassword: 'pass-1234', pin: '5555' });
    await t.db.user.update({ where: { id: gone.id }, data: { isActive: false } });
    await expect(pinLogin(t.db, { userId: gone.id, pin: '5555' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('the lock screen lists only active users with a PIN, and no secrets', async () => {
    const list = await listPinUsers(t.db);
    expect(list.map((u) => u.username).sort()).toEqual(['pin1', 'pin2', 'pin3']);
    expect(JSON.stringify(list)).not.toMatch(/\$2|pinCode|passwordHash/);
  });

  it('removing the PIN takes the user off the lock screen', async () => {
    const actor = await t.db.user.findUniqueOrThrow({ where: { username: 'pin1' } });
    const me = {
      id: actor.id,
      username: actor.username,
      fullName: actor.fullName,
      role: actor.role,
    };
    expect(await setPin(t.db, me, { currentPassword: 'pass-1234', pin: null })).toEqual({
      hasPin: false,
    });
    expect((await listPinUsers(t.db)).map((u) => u.username)).not.toContain('pin1');
  });
});
