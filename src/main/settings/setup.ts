import type { SetupInput } from '@shared/schemas';
import type { CurrentUser, SetupStatus } from '@shared/types';
import { hashPassword, toCurrentUser } from '../auth/auth';
import type { Db, DbOrTx } from '../domain/db';
import { conflict } from '../domain/errors';
import { setDefaultTables } from '../halls/halls';
import { getSettings, RECEIPT_SETTINGS_ID, setSetting } from './settings';

/**
 * Legacy rule kept: setup is complete when the flag is set, or when an admin and receipt settings
 * both exist (installs where the flag was never written).
 */
export async function getSetupStatus(db: DbOrTx): Promise<SetupStatus> {
  const [settings, adminCount, receiptCount] = await Promise.all([
    getSettings(db),
    db.user.count({ where: { role: 'ADMIN' } }),
    db.receiptSettings.count(),
  ]);
  const hasAdmin = adminCount > 0;
  return { setupComplete: settings.setupComplete || (hasAdmin && receiptCount > 0), hasAdmin };
}

/**
 * First-run wizard: first admin, receipt settings and table count, all or nothing. Refused once
 * setup is complete or any admin exists, so this public endpoint cannot be used to add admins.
 */
export async function completeSetup(db: Db, input: SetupInput): Promise<CurrentUser> {
  const passwordHash = await hashPassword(input.admin.password); // outside the transaction: slow

  return db.$transaction(async (tx) => {
    const status = await getSetupStatus(tx);
    if (status.setupComplete || status.hasAdmin) throw conflict('Sozlash allaqachon bajarilgan');

    const admin = await tx.user.create({
      data: {
        username: input.admin.username,
        fullName: input.admin.fullName,
        passwordHash,
        role: 'ADMIN',
      },
    });

    await tx.receiptSettings.upsert({
      where: { id: RECEIPT_SETTINGS_ID },
      update: input.receipt,
      create: { id: RECEIPT_SETTINGS_ID, ...input.receipt },
    });
    await setSetting(tx, 'tableCount', input.tableCount);
    await setDefaultTables(tx, input.tableCount);
    await setSetting(tx, 'setupComplete', true);

    return toCurrentUser(admin);
  });
}
