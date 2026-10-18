import type { PrismaClient } from '../../generated/prisma-sqlite';
import type { Migration } from './migrations';

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
}

export interface MigrateOptions {
  /**
   * Called once, before the first pending migration, when the database already holds a schema
   * (user_version > 0). Must leave a restorable copy; a throw aborts the upgrade.
   */
  backup?: (fromVersion: number) => Promise<unknown>;
}

/**
 * Splits migration SQL into single statements (Prisma's SQLite raw API runs one at a time).
 * A statement ends at a line ending in `;`, except inside CREATE TRIGGER, whose body has its own
 * semicolons and ends at a line `END;`. Whole-line `--` comments are dropped.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current: string[] = [];

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('--')) continue;
    current.push(line);

    const inTrigger = /^CREATE\s+(TEMP(ORARY)?\s+)?TRIGGER\b/i.test(current[0]!.trim());
    const ends = inTrigger ? /^END\s*;$/i.test(trimmed) : trimmed.endsWith(';');
    if (ends) {
      statements.push(current.join('\n').trim().replace(/;$/, ''));
      current = [];
    }
  }

  const rest = current.join('\n').trim();
  if (rest) statements.push(rest.replace(/;$/, ''));
  return statements;
}

export async function getUserVersion(prisma: PrismaClient): Promise<number> {
  const rows =
    await prisma.$queryRawUnsafe<Array<{ user_version: number | bigint }>>('PRAGMA user_version');
  return Number(rows[0]?.user_version ?? 0);
}

/**
 * Brings the database up to the last migration. Each migration runs in its own transaction
 * together with its user_version bump, so a failure leaves the database at the previous version,
 * never half-migrated. A database newer than this build is refused rather than touched.
 */
export async function runMigrations(
  prisma: PrismaClient,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): Promise<MigrationResult> {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migration list broken: #${i} has version ${m.version}, expected ${i + 1}`);
    }
  });

  const from = await getUserVersion(prisma);
  const latest = migrations.length;

  if (from > latest) {
    throw new Error(
      `Database schema v${from} is newer than this app (v${latest}). Install the newer SavdoChef version.`,
    );
  }

  const pending = migrations.slice(from);
  if (pending.length === 0) return { from, to: from, applied: [] };

  if (from > 0 && options.backup) await options.backup(from);

  const applied: string[] = [];
  for (const migration of pending) {
    const statements = splitStatements(migration.sql);
    await prisma.$transaction(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      // PRAGMA takes no bound parameters; version is an integer from our own list.
      await tx.$executeRawUnsafe(`PRAGMA user_version = ${Number(migration.version)}`);
    });
    applied.push(`${migration.version}_${migration.name}`);
  }

  return { from, to: latest, applied };
}
