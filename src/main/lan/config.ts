import { randomUUID } from 'node:crypto';
import type { Db, DbOrTx } from '../domain/db';
import { getSettings, setSetting } from '../settings/settings';

/**
 * Feature F12: this till's LAN role, kept in its own settings table (key/value JSON).
 * - `lan_role`: 'main' (default: every till in the field) or 'satellite';
 * - `lan_port`: where a main till listens;
 * - `lan_lineage`: a random id the main till makes when it first pairs; a satellite keeps its
 *   main's and refuses a different till answering at that address (posgro §11.3);
 * - `lan_link`: a satellite's main address and device credential (the secret encrypted with the
 *   machine's key, Electron safeStorage, injected as `Cipher`).
 * `lan_enabled` ("accept satellites") is an ordinary app setting (settings.ts).
 */

export type LanRole = 'main' | 'satellite';
export const DEFAULT_LAN_PORT = 5180;

export interface SatelliteLink {
  mainUrl: string;
  deviceId: number;
  secret: string;
  lineage: string;
  /** The main till's version when it paired (shown only). */
  mainVersion: string;
}

export interface Cipher {
  /** Recorded with the value, so a later read knows how to open it whatever is available then. */
  name: 'dpapi' | 'plain';
  encrypt(plain: string): string;
  decrypt(stored: string): string;
}

/** Tests and machines without an OS keychain: stored as is (the database is local to the till). */
export const plainCipher: Cipher = { name: 'plain', encrypt: (s) => s, decrypt: (s) => s };

type StoredSecret = { enc: 'dpapi' | 'plain'; v: string };

const KEY = {
  role: 'lan_role',
  port: 'lan_port',
  lineage: 'lan_lineage',
  link: 'lan_link',
} as const;

async function read(db: DbOrTx, key: string): Promise<unknown> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return undefined;
  }
}

async function write(db: DbOrTx, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await db.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
}

export async function getRole(db: DbOrTx): Promise<LanRole> {
  return (await read(db, KEY.role)) === 'satellite' ? 'satellite' : 'main';
}

export async function getPort(db: DbOrTx): Promise<number> {
  const v = await read(db, KEY.port);
  return typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535
    ? v
    : DEFAULT_LAN_PORT;
}

export async function setPort(db: DbOrTx, port: number): Promise<void> {
  await write(db, KEY.port, port);
}

export async function isEnabled(db: DbOrTx): Promise<boolean> {
  return (await getSettings(db)).lanEnabled;
}

export async function setEnabled(db: DbOrTx, enabled: boolean): Promise<void> {
  await setSetting(db, 'lanEnabled', enabled);
}

/** The main till's lineage, made on first use. */
export async function ensureLineage(db: DbOrTx): Promise<string> {
  const v = await read(db, KEY.lineage);
  if (typeof v === 'string' && v) return v;
  const id = randomUUID();
  await write(db, KEY.lineage, id);
  return id;
}

export async function getLink(db: DbOrTx, cipher: Cipher): Promise<SatelliteLink | null> {
  const v = (await read(db, KEY.link)) as
    | (Omit<SatelliteLink, 'secret'> & { secret: StoredSecret | string })
    | undefined;
  if (!v || typeof v.mainUrl !== 'string' || typeof v.deviceId !== 'number') return null;
  try {
    const stored = v.secret;
    const secret =
      typeof stored === 'string'
        ? cipher.decrypt(stored)
        : stored.enc === 'plain'
          ? stored.v
          : cipher.name === 'dpapi'
            ? cipher.decrypt(stored.v)
            : null;
    return secret ? { ...v, secret } : null;
  } catch {
    return null; // the keychain changed: the satellite has to pair again
  }
}

/** The main till's address a satellite had, even when its credential cannot be read. */
export async function getLinkAddress(db: DbOrTx): Promise<string | null> {
  const v = (await read(db, KEY.link)) as { mainUrl?: unknown } | undefined;
  return typeof v?.mainUrl === 'string' ? v.mainUrl : null;
}

/** Becomes a satellite of `link` (the app restarts afterwards). */
export async function becomeSatellite(db: Db, link: SatelliteLink, cipher: Cipher): Promise<void> {
  await db.$transaction(async (tx) => {
    const secret: StoredSecret = { enc: cipher.name, v: cipher.encrypt(link.secret) };
    await write(tx, KEY.link, { ...link, secret });
    await write(tx, KEY.role, 'satellite');
  });
}

/** Back to a main till of its own (its own database, as it was before pairing). */
export async function becomeMain(db: Db): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.setting.deleteMany({ where: { key: KEY.link } });
    await write(tx, KEY.role, 'main');
  });
}
