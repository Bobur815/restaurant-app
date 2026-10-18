import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import {
  createUser as createUserViaModule,
  listUsers,
  updateProfile,
  updateUser,
} from '../users/users';
import { changePassword, LOCK_MINUTES, login, MAX_FAILED_LOGINS, refreshActor } from './auth';

jest.setTimeout(30_000);

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe('login', () => {
  it('returns the user without any password data', async () => {
    await createUser(t.db, { username: 'kassa1', password: 'right-pass' });
    const user = await login(t.db, { username: 'kassa1', password: 'right-pass' });
    expect(user).toEqual({
      id: expect.any(Number),
      username: 'kassa1',
      fullName: null,
      role: 'STAFF',
    });
  });

  it('gives the same answer for an unknown user and a wrong password', async () => {
    await createUser(t.db, { username: 'kassa2', password: 'right-pass' });
    const a = login(t.db, { username: 'nobody', password: 'x' });
    const b = login(t.db, { username: 'kassa2', password: 'wrong' });
    await expect(a).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
      message: "Login yoki parol noto'g'ri",
    });
    await expect(b).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
      message: "Login yoki parol noto'g'ri",
    });
  });

  it(`locks for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong passwords, even for the right one`, async () => {
    await createUser(t.db, { username: 'kassa3', password: 'right-pass' });
    const now = new Date('2026-10-18T10:00:00Z');
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await expect(login(t.db, { username: 'kassa3', password: 'bad' }, now)).rejects.toMatchObject(
        {
          code: 'NOT_AUTHENTICATED',
        },
      );
    }
    await expect(
      login(t.db, { username: 'kassa3', password: 'right-pass' }, now),
    ).rejects.toMatchObject({
      code: 'LOCKED',
    });
    const later = new Date(now.getTime() + LOCK_MINUTES * 60_000 + 1);
    await expect(
      login(t.db, { username: 'kassa3', password: 'right-pass' }, later),
    ).resolves.toMatchObject({
      username: 'kassa3',
    });
  });

  it('a successful login resets the failure counter', async () => {
    await createUser(t.db, { username: 'kassa4', password: 'right-pass' });
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) {
      await login(t.db, { username: 'kassa4', password: 'bad' }).catch(() => undefined);
    }
    await login(t.db, { username: 'kassa4', password: 'right-pass' });
    await login(t.db, { username: 'kassa4', password: 'bad' }).catch(() => undefined);
    await expect(login(t.db, { username: 'kassa4', password: 'right-pass' })).resolves.toBeTruthy();
  });

  it('refuses inactive users only after the password is right', async () => {
    await createUser(t.db, { username: 'old', password: 'right-pass', isActive: false });
    await expect(login(t.db, { username: 'old', password: 'bad' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
    await expect(login(t.db, { username: 'old', password: 'right-pass' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('passwords and users', () => {
  it('stores bcrypt hashes, never the plaintext', async () => {
    await createUserViaModule(t.db, {
      username: 'newbie',
      password: 'plain-secret',
      fullName: null,
      role: 'STAFF',
    });
    const row = await t.db.user.findUniqueOrThrow({ where: { username: 'newbie' } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(row.passwordHash).not.toContain('plain-secret');
    expect(JSON.stringify(await listUsers(t.db))).not.toContain('$2');
  });

  it('changePassword requires the current password', async () => {
    const actor = await createUser(t.db, { username: 'changer', password: 'old-pass' });
    await expect(
      changePassword(t.db, actor, { currentPassword: 'nope', newPassword: 'new-pass' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await changePassword(t.db, actor, { currentPassword: 'old-pass', newPassword: 'new-pass' });
    await expect(login(t.db, { username: 'changer', password: 'new-pass' })).resolves.toBeTruthy();
  });

  it('duplicate usernames are a CONFLICT', async () => {
    await expect(
      createUserViaModule(t.db, {
        username: 'newbie',
        password: 'whatever',
        fullName: null,
        role: 'STAFF',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const actor = await createUser(t.db, { username: 'renamer' });
    await expect(updateProfile(t.db, actor, { username: 'newbie' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('never leaves the system without an active admin', async () => {
    const t2 = await createTestDb();
    try {
      const admin = await createUser(t2.db, { username: 'boss', role: 'ADMIN' });
      await expect(updateUser(t2.db, admin, { id: admin.id, role: 'STAFF' })).rejects.toMatchObject(
        { code: 'CONFLICT' },
      );
      await expect(
        updateUser(t2.db, admin, { id: admin.id, isActive: false }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const second = await createUser(t2.db, { username: 'boss2', role: 'ADMIN' });
      await expect(
        updateUser(t2.db, second, { id: admin.id, role: 'STAFF' }),
      ).resolves.toMatchObject({ role: 'STAFF' });
      // Self-deactivation is refused even when another admin exists.
      await expect(
        updateUser(t2.db, second, { id: second.id, isActive: false }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      await t2.close();
    }
  });

  it('refreshActor drops a deactivated user', async () => {
    const actor = await createUser(t.db, { username: 'leaver' });
    expect(await refreshActor(t.db, actor)).toEqual(actor);
    await t.db.user.update({ where: { id: actor.id }, data: { isActive: false } });
    expect(await refreshActor(t.db, actor)).toBeNull();
  });
});
