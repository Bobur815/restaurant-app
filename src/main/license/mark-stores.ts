import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { Db } from '../domain/db';
import type { MarkStore } from './trusted-clock';

/** The trusted clock's mark in SQLite (license_state.clockMark). */
export function dbMarkStore(db: () => Db): MarkStore {
  return {
    async read() {
      const row = await db().licenseState.findUnique({
        where: { id: 1 },
        select: { clockMark: true },
      });
      return row?.clockMark ? row.clockMark.getTime() : null;
    },
    async write(ms) {
      await db().licenseState.updateMany({ where: { id: 1 }, data: { clockMark: new Date(ms) } });
    },
  };
}

const PLAIN = 'plain:';

/**
 * The second copy, in userData, encrypted with Electron safeStorage (DPAPI on Windows) so it cannot
 * simply be edited. Where safeStorage has no key it is still a second copy, in plain text.
 */
export function fileMarkStore(userData: string): MarkStore {
  const file = path.join(userData, 'license-clock.bin');
  return {
    async read() {
      try {
        const raw = await readFile(file);
        const plain = raw.subarray(0, PLAIN.length).toString() === PLAIN;
        // Where encryption works, a plain copy was not written by this app: ignore it.
        if (plain && safeStorage.isEncryptionAvailable()) return null;
        const text = plain ? raw.subarray(PLAIN.length).toString() : safeStorage.decryptString(raw);
        const ms = Number(text);
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    },
    async write(ms) {
      try {
        const data = safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(String(ms))
          : Buffer.from(PLAIN + String(ms));
        await writeFile(file, data);
      } catch {
        // A second copy only: the SQLite one still holds.
      }
    },
  };
}
