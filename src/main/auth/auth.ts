import bcrypt from 'bcryptjs';
import type { z } from 'zod';
import type { changePasswordInput, loginInput, pinLoginInput, setPinInput } from '@shared/schemas';
import type { CurrentUser, PinUserDto } from '@shared/types';
import type { Actor, Db } from '../domain/db';
import { AppError, invalid } from '../domain/errors';

export const BCRYPT_COST = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 5;

const BAD_CREDENTIALS = "Login yoki parol noto'g'ri";

// Compared against when the username does not exist, so a miss costs the same time as a wrong
// password and response time does not reveal which usernames exist.
const DUMMY_HASH = bcrypt.hashSync('savdochef-dummy-password', BCRYPT_COST);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function toCurrentUser(user: {
  id: number;
  username: string;
  fullName: string | null;
  role: 'ADMIN' | 'STAFF';
}): CurrentUser {
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

type UserRow = NonNullable<Awaited<ReturnType<Db['user']['findUnique']>>>;

/**
 * The lock-and-verify step shared by password and PIN login: a locked account is refused even
 * with the right secret; a wrong secret counts towards the same lock (MAX_FAILED_LOGINS in a row
 * -> LOCK_MINUTES); a right one resets the counter. Inactive users are refused only after the
 * secret is right, so the answer does not reveal which accounts exist or are disabled.
 */
async function verifySecret(
  db: Db,
  user: UserRow,
  secret: string,
  hash: string,
  badMessage: string,
  now: Date,
): Promise<CurrentUser> {
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AppError(
      'LOCKED',
      'Juda ko‘p noto‘g‘ri urinish. Birozdan keyin qayta urinib ko‘ring',
      {
        lockedUntil: user.lockedUntil.toISOString(),
      },
    );
  }

  if (!(await bcrypt.compare(secret, hash))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      },
    });
    throw new AppError('NOT_AUTHENTICATED', badMessage);
  }

  if (!user.isActive) throw new AppError('FORBIDDEN', 'Foydalanuvchi faol emas');

  const updated = await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  return toCurrentUser(updated);
}

/**
 * Checks credentials and returns the user. After MAX_FAILED_LOGINS wrong passwords in a row
 * the account is locked for LOCK_MINUTES (LOCKED, with `details.lockedUntil`).
 */
export async function login(
  db: Db,
  input: z.infer<typeof loginInput>,
  now: Date = new Date(),
): Promise<CurrentUser> {
  const user = await db.user.findUnique({ where: { username: input.username } });
  if (!user) {
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw new AppError('NOT_AUTHENTICATED', BAD_CREDENTIALS);
  }
  return verifySecret(db, user, input.password, user.passwordHash, BAD_CREDENTIALS, now);
}

// ── Lock-screen PIN ──────────────────────────────────────────────────────────────────────────

const BAD_PIN = "PIN kod noto'g'ri";

/** Who can unlock with a PIN: active users that set one. Names only, never the hash. */
export async function listPinUsers(db: Db): Promise<PinUserDto[]> {
  return db.user.findMany({
    where: { isActive: true, pinCode: { not: null } },
    select: { id: true, username: true, fullName: true },
    orderBy: [{ fullName: 'asc' }, { username: 'asc' }],
  });
}

/**
 * Unlock with a user's PIN (chosen on the lock screen). Same lock as password login: 5 wrong
 * attempts lock the account for 5 minutes, which is what keeps a 4-digit PIN from being guessed.
 */
export async function pinLogin(
  db: Db,
  input: z.infer<typeof pinLoginInput>,
  now: Date = new Date(),
): Promise<CurrentUser> {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || !user.pinCode) {
    await bcrypt.compare(input.pin, DUMMY_HASH);
    throw new AppError('NOT_AUTHENTICATED', BAD_PIN);
  }
  return verifySecret(db, user, input.pin, user.pinCode, BAD_PIN, now);
}

export async function pinStatus(db: Db, actor: Actor): Promise<{ hasPin: boolean }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { pinCode: true },
  });
  return { hasPin: user.pinCode !== null };
}

/** Sets, changes (`pin`) or removes (`pin: null`) the caller's PIN; the password confirms it. */
export async function setPin(
  db: Db,
  actor: Actor,
  input: z.infer<typeof setPinInput>,
): Promise<{ hasPin: boolean }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw invalid("Joriy parol noto'g'ri", { field: 'currentPassword' });
  }
  await db.user.update({
    where: { id: actor.id },
    data: { pinCode: input.pin === null ? null : await hashPassword(input.pin) },
  });
  return { hasPin: input.pin !== null };
}

/**
 * The actor as stored now, or null if the account was deleted or deactivated since login.
 * Handlers call this so a deactivated user is cut off on their next action, not next login.
 */
export async function refreshActor(db: Db, actor: Actor): Promise<Actor | null> {
  const user = await db.user.findUnique({ where: { id: actor.id } });
  return user && user.isActive ? toCurrentUser(user) : null;
}

export async function changePassword(
  db: Db,
  actor: Actor,
  input: z.infer<typeof changePasswordInput>,
): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw invalid("Joriy parol noto'g'ri", { field: 'currentPassword' });
  }
  if (input.currentPassword === input.newPassword) {
    throw invalid('Yangi parol eskisidan farq qilishi kerak', { field: 'newPassword' });
  }
  await db.user.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });
}
