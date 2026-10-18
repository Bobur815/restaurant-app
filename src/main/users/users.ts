import type { z } from 'zod';
import type {
  createUserInput,
  resetPasswordInput,
  updateProfileInput,
  updateUserInput,
} from '@shared/schemas';
import type { CurrentUser, UserDto } from '@shared/types';
import { hashPassword, toCurrentUser } from '../auth/auth';
import { iso, isoOrNull, type Actor, type Db, type Tx } from '../domain/db';
import { conflict, isUniqueViolation, notFound } from '../domain/errors';

type UserRow = {
  id: number;
  username: string;
  fullName: string | null;
  role: 'ADMIN' | 'STAFF';
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export function toUserDto(u: UserRow): UserDto {
  return {
    ...toCurrentUser(u),
    isActive: u.isActive,
    lastLoginAt: isoOrNull(u.lastLoginAt),
    createdAt: iso(u.createdAt),
  };
}

const USERNAME_TAKEN = 'Bu login band';

export async function listUsers(db: Db): Promise<UserDto[]> {
  const users = await db.user.findMany({ orderBy: [{ isActive: 'desc' }, { username: 'asc' }] });
  return users.map(toUserDto);
}

export async function createUser(db: Db, input: z.infer<typeof createUserInput>): Promise<UserDto> {
  try {
    const user = await db.user.create({
      data: {
        username: input.username,
        fullName: input.fullName,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      },
    });
    return toUserDto(user);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(USERNAME_TAKEN, { field: 'username' });
    throw error;
  }
}

/** Refuses any change that would leave the system without an active admin. */
async function assertOtherActiveAdmin(tx: Tx, userId: number): Promise<void> {
  const others = await tx.user.count({
    where: { role: 'ADMIN', isActive: true, id: { not: userId } },
  });
  if (others === 0) throw conflict('Kamida bitta faol administrator qolishi kerak');
}

export async function updateUser(
  db: Db,
  actor: Actor,
  input: z.infer<typeof updateUserInput>,
): Promise<UserDto> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.id } });
    if (!user) throw notFound('Foydalanuvchi');

    const losesAdmin =
      user.role === 'ADMIN' &&
      user.isActive &&
      ((input.role !== undefined && input.role !== 'ADMIN') || input.isActive === false);
    if (losesAdmin) await assertOtherActiveAdmin(tx, user.id);
    if (input.isActive === false && user.id === actor.id) {
      throw conflict("O'zingizni faolsizlantira olmaysiz");
    }

    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        fullName: input.fullName,
        role: input.role,
        isActive: input.isActive,
        // Re-enabling an account also clears a login lock.
        ...(input.isActive ? { failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });
    return toUserDto(updated);
  });
}

export async function resetPassword(
  db: Db,
  input: z.infer<typeof resetPasswordInput>,
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: input.id } });
  if (!user) throw notFound('Foydalanuvchi');
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
}

/** The logged-in user edits their own login name and display name. */
export async function updateProfile(
  db: Db,
  actor: Actor,
  input: z.infer<typeof updateProfileInput>,
): Promise<CurrentUser> {
  try {
    const updated = await db.user.update({
      where: { id: actor.id },
      data: { username: input.username, fullName: input.fullName },
    });
    return toCurrentUser(updated);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(USERNAME_TAKEN, { field: 'username' });
    throw error;
  }
}
