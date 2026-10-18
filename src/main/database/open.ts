import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '../../generated/prisma-sqlite';
import { runMigrations, type MigrationResult } from './migrate';
import { MIGRATIONS, type Migration } from './migrations';
import { seedDatabase } from './seed';

/**
 * Electron-free: everything needed to open a SavdoChef database file, so tests run the exact
 * code path the app does. sqlite-client.ts adds the Electron paths around it.
 */

export type PrismaModule = typeof import('../../generated/prisma-sqlite');

/**
 * The generated client, loaded by a runtime path rather than an import: a static import would
 * pull the generated client, with its native query engine references, into the main bundle.
 * The engine is a .node file that must stay on disk (asarUnpack). Same approach as posgro.
 */
export function loadPrismaModule(appRoot: string): PrismaModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(appRoot, 'src', 'generated', 'prisma-sqlite')) as PrismaModule;
}

export interface OpenOptions {
  prismaModule: PrismaModule;
  /** Directory for pre-migration backups. Omit to skip backups (tests). */
  backupDir?: string;
  /** Override the migration list (tests). */
  migrations?: readonly Migration[];
  log?: (message: string) => void;
}

export interface OpenedDatabase {
  prisma: PrismaClient;
  migration: MigrationResult;
  freshDatabase: boolean;
}

export const BACKUPS_TO_KEEP = 10;

export async function openDatabase(dbFile: string, options: OpenOptions): Promise<OpenedDatabase> {
  const log = options.log ?? (() => undefined);
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  // One connection: SQLite serialises writers anyway, and per-connection PRAGMAs (busy_timeout,
  // foreign_keys) set below then hold for every query.
  const prisma = new options.prismaModule.PrismaClient({
    datasources: { db: { url: `file:${dbFile}?connection_limit=1&socket_timeout=10` } },
    log: ['error'],
  });

  try {
    await prisma.$connect();
    // WAL: readers (reports, a second device over LAN) do not block the till's writes, and a
    // crash mid-write cannot corrupt the main file. busy_timeout waits instead of failing fast.
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    const migration = await runMigrations(prisma, options.migrations ?? MIGRATIONS, {
      backup: options.backupDir
        ? (fromVersion) => backupDatabase(prisma, options.backupDir!, fromVersion, log)
        : undefined,
    });
    const freshDatabase = migration.from === 0;
    if (migration.applied.length) {
      log(`[db] migrated v${migration.from} -> v${migration.to}: ${migration.applied.join(', ')}`);
    }

    await seedDatabase(prisma, { freshDatabase });
    return { prisma, migration, freshDatabase };
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

/** Consistent copy of a live database (WAL included) via VACUUM INTO; keeps the newest few. */
export async function backupDatabase(
  prisma: PrismaClient,
  backupDir: string,
  fromVersion: number,
  log: (message: string) => void = () => undefined,
): Promise<string> {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `savdochef-v${fromVersion}-${stamp}.db`);
  // VACUUM INTO takes a string literal; the path is ours (userData), quotes escaped regardless.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  log(`[db] backup written: ${target}`);
  pruneBackups(backupDir, BACKUPS_TO_KEEP);
  return target;
}

function pruneBackups(dir: string, keep: number): void {
  const backups = fs
    .readdirSync(dir)
    .filter((f) => /^savdochef-v\d+-.*\.db$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of backups.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
}
