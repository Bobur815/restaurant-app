import fs from 'fs';
import os from 'os';
import path from 'path';
import { ROLE_DEFAULTS, type Permission, type Role } from '@shared/permissions';
import { setPinOf, toCurrentUser } from '../auth/auth';
import type { Actor, Db } from '../domain/db';
import { loadPrismaModule, openDatabase } from '../database/open';

const ROOT = path.join(__dirname, '..', '..', '..');
const prismaModule = loadPrismaModule(ROOT);

export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

/** A fresh, fully migrated and seeded database file in the OS temp dir. */
export async function createTestDb(): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savdochef-test-'));
  const { prisma } = await openDatabase(path.join(dir, 'savdochef.db'), { prismaModule });
  return {
    db: prisma,
    async close() {
      await prisma.$disconnect();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A user for tests. `username` is only the display name now (login is a PIN, feature F2);
 * permissions default to the role's; `pin` makes them able to log in.
 */
export async function createUser(
  db: Db,
  data: {
    username: string;
    role?: Role;
    permissions?: Permission[];
    pin?: string;
    phone?: string;
    isActive?: boolean;
  },
): Promise<Actor> {
  const role = data.role ?? 'STAFF';
  const user = await db.user.create({
    data: {
      fullName: data.username,
      phone: data.phone ?? null,
      role,
      permissions: JSON.stringify(data.permissions ?? ROLE_DEFAULTS[role]),
      isActive: data.isActive ?? true,
    },
  });
  if (data.pin) await setPinOf(db, user.id, data.pin);
  return toCurrentUser(user);
}
