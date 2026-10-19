import { app } from 'electron';
import path from 'path';
import type { PrismaClient } from '../../generated/prisma-sqlite';
import { logger } from '../logger';
import { loadPrismaModule, openDatabase, type PrismaModule } from './open';

let prisma: PrismaClient | null = null;
let prismaModule: PrismaModule | null = null;

export function databaseFilePath(): string {
  return path.join(app.getPath('userData'), 'data', 'savdochef.db');
}

export function backupDirPath(): string {
  return path.join(app.getPath('userData'), 'backups');
}

/** Opens (creating or upgrading as needed) the local database. Call once, before any window. */
export async function initializeDatabase(): Promise<PrismaClient> {
  if (prisma) return prisma;
  const dbFile = databaseFilePath();
  // In a package the client sits under app.asar (JS) / app.asar.unpacked (engine); in dev, the repo.
  prismaModule = loadPrismaModule(app.getAppPath());
  const opened = await openDatabase(dbFile, {
    prismaModule,
    backupDir: backupDirPath(),
    log: (m) => logger.info(m),
  });
  logger.info(
    `[db] ${path.basename(dbFile)} schema v${opened.migration.to}${opened.freshDatabase ? ' (new)' : ''}`,
  );
  prisma = opened.prisma;
  return prisma;
}

export function getPrisma(): PrismaClient {
  if (!prisma) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return prisma;
}

/** `Prisma` namespace of the generated client (Prisma.Decimal, error classes). */
export function getPrismaNamespace(): PrismaModule['Prisma'] {
  if (!prismaModule) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return prismaModule.Prisma;
}

export async function closeDatabase(): Promise<void> {
  if (!prisma) return;
  await prisma.$disconnect();
  prisma = null;
}
