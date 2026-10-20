import type { z } from 'zod';
import { hasPermission, ROLE_DEFAULTS } from '@shared/permissions';
import type { createUserInput, updateProfileInput, updateUserInput } from '@shared/schemas';
import type { CurrentUser, UserDto } from '@shared/types';
import { setPinOf, toCurrentUser } from '../auth/auth';
import type { Actor, Db, Tx } from '../domain/db';
import { iso, isoOrNull } from '../domain/db';
import { conflict, isUniqueViolation, notFound } from '../domain/errors';

/**
 * Users (feature F2): a name, a unique phone, a role (template) and the permissions actually
 * granted, plus a unique 4-digit PIN that only users with the `users` permission set. Nobody can
 * remove the last active user who manages users (the shop would lock itself out).
 */

type UserRow = Parameters<typeof toCurrentUser>[0] & {
  isActive: boolean;
  pinHash: string | null;
  legacyPinCode: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export function toUserDto(u: UserRow): UserDto {
  return {
    ...toCurrentUser(u),
    isActive: u.isActive,
    hasPin: u.pinHash !== null || u.legacyPinCode !== null,
    lastLoginAt: isoOrNull(u.lastLoginAt),
    createdAt: iso(u.createdAt),
  };
}

const PHONE_TAKEN = 'Bu telefon raqami boshqa foydalanuvchida';

function uniqueFailure(error: unknown): never {
  if (isUniqueViolation(error)) throw conflict(PHONE_TAKEN, { field: 'phone' });
  throw error;
}

export async function listUsers(db: Db): Promise<UserDto[]> {
  const users = await db.user.findMany({ orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }] });
  return users.map(toUserDto);
}

export async function createUser(db: Db, input: z.infer<typeof createUserInput>): Promise<UserDto> {
  const id = await db.$transaction(async (tx) => {
    const user = await tx.user
      .create({
        data: {
          fullName: input.fullName,
          phone: input.phone,
          role: input.role,
          permissions: JSON.stringify(input.permissions ?? ROLE_DEFAULTS[input.role]),
        },
      })
      .catch(uniqueFailure);
    if (input.pin) await setPinOf(tx, user.id, input.pin);
    return user.id;
  });
  return toUserDto(await db.user.findUniqueOrThrow({ where: { id } }));
}

/** Refuses a change that would leave no active user who can manage users. */
async function assertAnotherUserManager(tx: Tx, userId: number): Promise<void> {
  const others = await tx.user.findMany({ where: { isActive: true, id: { not: userId } } });
  if (!others.some((u) => hasPermission(toCurrentUser(u), 'users')))
    throw conflict('Foydalanuvchilarni boshqaradigan kamida bitta faol xodim qolishi kerak');
}

/**
 * Edits a user. A new role with no permissions given resets them to the role's defaults; given
 * permissions win. `pin`: a new PIN, null removes it, omitted keeps it.
 */
export async function updateUser(
  db: Db,
  actor: Actor,
  input: z.infer<typeof updateUserInput>,
): Promise<UserDto> {
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.id } });
    if (!user) throw notFound('Foydalanuvchi');

    const permissions =
      input.permissions ??
      (input.role && input.role !== user.role ? [...ROLE_DEFAULTS[input.role]] : undefined);
    const managedBefore = user.isActive && hasPermission(toCurrentUser(user), 'users');
    const managesAfter =
      (input.isActive ?? user.isActive) &&
      (permissions ? permissions.includes('users') : managedBefore);
    if (managedBefore && !managesAfter) await assertAnotherUserManager(tx, user.id);
    if (input.isActive === false && user.id === actor.id)
      throw conflict("O'zingizni faolsizlantira olmaysiz");

    await tx.user
      .update({
        where: { id: user.id },
        data: {
          fullName: input.fullName,
          phone: input.phone,
          role: input.role,
          isActive: input.isActive,
          ...(permissions ? { permissions: JSON.stringify(permissions) } : {}),
        },
      })
      .catch(uniqueFailure);
    if (input.pin !== undefined) await setPinOf(tx, user.id, input.pin);
  });
  return toUserDto(await db.user.findUniqueOrThrow({ where: { id: input.id } }));
}

/** The logged-in user edits their own name and phone (the PIN is set by a user manager). */
export async function updateProfile(
  db: Db,
  actor: Actor,
  input: z.infer<typeof updateProfileInput>,
): Promise<CurrentUser> {
  const updated = await db.user
    .update({ where: { id: actor.id }, data: { fullName: input.fullName, phone: input.phone } })
    .catch(uniqueFailure);
  return toCurrentUser(updated);
}
