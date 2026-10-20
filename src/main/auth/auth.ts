import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import type { z } from 'zod';
import { cleanPermissions, hasPermission, type Role } from '@shared/permissions';
import type { bootstrapPinInput, recoverInput } from '@shared/schemas';
import type { AdminChoiceDto, CurrentUser, LoginWithCodeDto } from '@shared/types';
import type { Actor, Db, DbOrTx, Tx } from '../domain/db';
import { AppError, conflict, isUniqueViolation, notFound } from '../domain/errors';

/**
 * Login is a 4-digit PIN only (feature F2, decided 2026-10-20). PINs are unique, so the PIN alone
 * says who is logging in; they are stored as HMAC-SHA256 with a random per-install key (settings
 * `pin_key`, made by seed), which makes them look-up-able and unique without keeping the digits.
 *
 * A PIN pad cannot be locked per user (any code is a guess at everyone), so it is locked per till:
 * MAX_FAILED wrong PINs lock it for LOCK_MINUTES, doubling each time it happens again, and the
 * lock survives a restart (settings `pin_lock`). The recovery code and the one-time administrator
 * step share the same lock.
 */

export const MAX_FAILED = 5;
export const LOCK_MINUTES = 5;
const PIN_KEY = 'pin_key';
const PIN_LOCK = 'pin_lock';
const RECOVERY = 'recovery_hash';

const BAD_PIN = "PIN kod noto'g'ri";

// ── PIN hashing ─────────────────────────────────────────────────────────────────────────────

async function pinKey(db: DbOrTx): Promise<Buffer> {
  const row = await db.setting.findUnique({ where: { key: PIN_KEY } });
  if (!row) throw new Error('pin_key missing (seed did not run)');
  return Buffer.from(JSON.parse(row.value) as string, 'hex');
}

/** The value stored for a PIN (also used for the recovery code). */
export async function pinHash(db: DbOrTx, secret: string): Promise<string> {
  return createHmac('sha256', await pinKey(db))
    .update(secret)
    .digest('hex');
}

/** A new random per-install key (seed, once). */
export const newPinKey = () => randomBytes(32).toString('hex');

/** Sets a user's PIN; a PIN another user has is refused (only PIN managers see this message). */
export async function setPinOf(tx: DbOrTx, userId: number, pin: string | null): Promise<void> {
  try {
    await tx.user.update({
      where: { id: userId },
      data: { pinHash: pin === null ? null : await pinHash(tx, pin), legacyPinCode: null },
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict('Bu PIN kod band. Boshqasini tanlang', { field: 'pin' });
    throw error;
  }
}

// ── users as the app sees them ───────────────────────────────────────────────────────────────

type UserRow = {
  id: number;
  fullName: string | null;
  phone: string | null;
  role: Role;
  permissions: string;
};

export function parsePermissions(json: string): CurrentUser['permissions'] {
  try {
    const list: unknown = JSON.parse(json);
    return Array.isArray(list) ? cleanPermissions(list.filter((x) => typeof x === 'string')) : [];
  } catch {
    return [];
  }
}

export function toCurrentUser(user: UserRow): CurrentUser {
  return {
    id: user.id,
    fullName: user.fullName ?? `#${user.id}`,
    phone: user.phone,
    role: user.role,
    permissions: parsePermissions(user.permissions),
  };
}

/**
 * The actor as stored now, or null if the account was deleted or deactivated since login.
 * Handlers call this so a change (deactivated, permissions removed) applies on the next action.
 */
export async function refreshActor(db: Db, actor: Actor): Promise<Actor | null> {
  const user = await db.user.findUnique({ where: { id: actor.id } });
  return user && user.isActive ? toCurrentUser(user) : null;
}

// ── till lock ────────────────────────────────────────────────────────────────────────────────

interface LockState {
  failures: number;
  /** How many times the pad was locked in a row (the lock doubles each time). */
  level: number;
  lockedUntil: string | null;
}

async function lockState(db: DbOrTx): Promise<LockState> {
  const row = await db.setting.findUnique({ where: { key: PIN_LOCK } });
  try {
    return row
      ? (JSON.parse(row.value) as LockState)
      : { failures: 0, level: 0, lockedUntil: null };
  } catch {
    return { failures: 0, level: 0, lockedUntil: null };
  }
}

async function writeLock(db: DbOrTx, state: LockState): Promise<void> {
  const value = JSON.stringify(state);
  await db.setting.upsert({
    where: { key: PIN_LOCK },
    update: { value },
    create: { key: PIN_LOCK, value },
  });
}

async function assertNotLocked(db: DbOrTx, now: Date): Promise<void> {
  const state = await lockState(db);
  if (state.lockedUntil && new Date(state.lockedUntil) > now) {
    throw new AppError(
      'LOCKED',
      'Juda ko‘p noto‘g‘ri urinish. Birozdan keyin qayta urinib ko‘ring',
      {
        lockedUntil: state.lockedUntil,
      },
    );
  }
}

async function failed(db: DbOrTx, now: Date, message: string): Promise<never> {
  const state = await lockState(db);
  const failures = state.failures + 1;
  if (failures >= MAX_FAILED) {
    const minutes = LOCK_MINUTES * 2 ** Math.min(state.level, 6);
    const lockedUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
    await writeLock(db, { failures: 0, level: state.level + 1, lockedUntil });
    throw new AppError(
      'LOCKED',
      'Juda ko‘p noto‘g‘ri urinish. Birozdan keyin qayta urinib ko‘ring',
      {
        lockedUntil,
      },
    );
  }
  await writeLock(db, { ...state, failures });
  throw new AppError('NOT_AUTHENTICATED', message, { attemptsLeft: MAX_FAILED - failures });
}

const succeeded = (db: DbOrTx) => writeLock(db, { failures: 0, level: 0, lockedUntil: null });

// ── login ────────────────────────────────────────────────────────────────────────────────────

async function signIn(db: DbOrTx, userId: number, now: Date): Promise<CurrentUser> {
  await succeeded(db);
  return toCurrentUser(await db.user.update({ where: { id: userId }, data: { lastLoginAt: now } }));
}

/**
 * Logs in by PIN alone. A PIN from an older version (bcrypt, `legacyPinCode`) still works once
 * and is converted; if two old PINs match, both users must get new ones from an administrator.
 */
export async function pinLogin(db: Db, pin: string, now: Date = new Date()): Promise<CurrentUser> {
  await assertNotLocked(db, now);
  let user = await db.user.findUnique({ where: { pinHash: await pinHash(db, pin) } });

  if (!user) {
    const legacy = await db.user.findMany({ where: { legacyPinCode: { not: null } } });
    const matches: typeof legacy = [];
    for (const u of legacy) if (await bcrypt.compare(pin, u.legacyPinCode!)) matches.push(u);
    if (matches.length > 1)
      throw conflict('Bu PIN kod bir nechta foydalanuvchida. Administrator yangi PIN bersin');
    if (matches[0]) {
      await setPinOf(db, matches[0].id, pin);
      user = matches[0];
    }
  }

  if (!user) return failed(db, now, BAD_PIN);
  if (!user.isActive) throw new AppError('FORBIDDEN', 'Foydalanuvchi faol emas');
  return signIn(db, user.id, now);
}

// ── recovery code ────────────────────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A new recovery code: 12 characters, shown once as XXXX-XXXX-XXXX; only its HMAC is kept. */
export async function newRecoveryCode(db: DbOrTx): Promise<string> {
  const raw = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(
    '',
  );
  const value = JSON.stringify(await pinHash(db, `recovery:${raw}`));
  await db.setting.upsert({
    where: { key: RECOVERY },
    update: { value },
    create: { key: RECOVERY, value },
  });
  return raw.match(/.{4}/g)!.join('-');
}

export async function hasRecoveryCode(db: DbOrTx): Promise<boolean> {
  return (await db.setting.count({ where: { key: RECOVERY } })) > 0;
}

/** The owner: the first active user who manages users (who the recovery code unlocks). */
async function owner(tx: DbOrTx) {
  const users = await tx.user.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
  return users.find((u) => hasPermission(toCurrentUser(u), 'users')) ?? null;
}

/** Forgotten admin PIN: the recovery code sets the owner's new PIN; a new code replaces it. */
export async function recoverWithCode(
  db: Db,
  input: z.infer<typeof recoverInput>,
  now: Date = new Date(),
): Promise<LoginWithCodeDto> {
  await assertNotLocked(db, now);
  const stored = await db.setting.findUnique({ where: { key: RECOVERY } });
  const given = await pinHash(db, `recovery:${normalizeCode(input.code)}`);
  const ok =
    stored !== null &&
    timingSafeEqual(Buffer.from(JSON.parse(stored.value) as string), Buffer.from(given));
  if (!ok) return failed(db, now, "Tiklash kodi noto'g'ri");

  return db.$transaction(async (tx) => {
    const admin = await owner(tx);
    if (!admin) throw notFound('Administrator');
    await setPinOf(tx, admin.id, input.pin);
    return { user: await signIn(tx, admin.id, now), recoveryCode: await newRecoveryCode(tx) };
  });
}

// ── first PIN for an administrator (upgrade with nobody able to log in) ─────────────────────

/** Nobody who manages users can log in: no new PIN and no old one. */
async function bootstrapNeeded(db: DbOrTx): Promise<boolean> {
  const users = await db.user.findMany({ where: { isActive: true } });
  return !users.some(
    (u) =>
      hasPermission(toCurrentUser(u), 'users') && (u.pinHash !== null || u.legacyPinCode !== null),
  );
}

export async function bootstrapStatus(
  db: Db,
): Promise<{ needed: boolean; admins: AdminChoiceDto[] }> {
  if (!(await bootstrapNeeded(db))) return { needed: false, admins: [] };
  const users = await db.user.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
  return {
    needed: true,
    admins: users
      .filter((u) => hasPermission(toCurrentUser(u), 'users'))
      .map((u) => ({ id: u.id, fullName: toCurrentUser(u).fullName })),
  };
}

/**
 * Only while nobody who manages users can log in (like the first-run setup): an administrator's
 * PIN is set, they are logged in, and the recovery code is made and shown once.
 */
export async function bootstrapPin(
  db: Db,
  input: z.infer<typeof bootstrapPinInput>,
  now: Date = new Date(),
): Promise<LoginWithCodeDto> {
  return db.$transaction(async (tx: Tx) => {
    if (!(await bootstrapNeeded(tx))) throw conflict('Administrator allaqachon PIN kodga ega');
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || !user.isActive || !hasPermission(toCurrentUser(user), 'users'))
      throw notFound('Administrator');
    await setPinOf(tx, user.id, input.pin);
    return { user: await signIn(tx, user.id, now), recoveryCode: await newRecoveryCode(tx) };
  });
}
