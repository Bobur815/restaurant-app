import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';
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

/** Low bcrypt cost keeps tests fast; production uses auth.BCRYPT_COST. */
export async function createUser(
  db: Db,
  data: { username: string; password?: string; role?: 'ADMIN' | 'STAFF'; isActive?: boolean },
): Promise<Actor> {
  const user = await db.user.create({
    data: {
      username: data.username,
      passwordHash: await bcrypt.hash(data.password ?? 'secret123', 4),
      role: data.role ?? 'STAFF',
      isActive: data.isActive ?? true,
    },
  });
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}
