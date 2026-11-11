import { randomBytes } from 'node:crypto';
import type { FiscalConfigInput } from '@shared/schemas';
import type { FiscalConfigDto } from '@shared/types';
import {
  FISCAL_VAT_MODES,
  type FiscalCodes,
  type FiscalVatMode,
} from '@shared/utils/fiscal-receipt';
import type { DbOrTx } from '../domain/db';
import { isUniqueViolation } from '../domain/errors';
import type { Cipher } from '../lan/config';

/**
 * Feature F18: the fiscal receipt settings, as JSON values in `settings` (keys `fiscal_*`). Not part
 * of AppSettings: `settings:get` is for every user, these are for `settings` only. The VCR
 * password is stored encrypted with the machine's key (Electron safeStorage, as the LAN secret)
 * and never leaves main.
 */

export const DEFAULT_VCR_PORT = 22298;

const KEY = {
  enabled: 'fiscal_enabled',
  host: 'fiscal_vcr_host',
  port: 'fiscal_vcr_port',
  login: 'fiscal_vcr_login',
  password: 'fiscal_vcr_password',
  vatMode: 'fiscal_vat_mode',
  defaultMxik: 'fiscal_default_mxik',
  defaultPackage: 'fiscal_default_package',
  serviceMxik: 'fiscal_service_mxik',
  servicePackage: 'fiscal_service_package',
  deliveryMxik: 'fiscal_delivery_mxik',
  deliveryPackage: 'fiscal_delivery_package',
  codePrefix: 'fiscal_code_prefix',
} as const;

type StoredSecret = { enc: Cipher['name']; v: string };

export interface ResolvedFiscalConfig {
  enabled: boolean;
  host: string;
  port: number;
  login: string;
  /** '' when none is saved or it cannot be decrypted on this machine. */
  password: string;
  codes: FiscalCodes;
}

async function readAll(db: DbOrTx): Promise<Map<string, unknown>> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: 'fiscal_' } } });
  const out = new Map<string, unknown>();
  for (const r of rows) {
    try {
      out.set(r.key, JSON.parse(r.value));
    } catch {
      // A broken value reads as its default.
    }
  }
  return out;
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

function decryptSecret(v: unknown, cipher: Cipher): string {
  const s = v as StoredSecret | undefined;
  if (!s || typeof s.v !== 'string' || !s.v) return '';
  // Written in clear only on a machine without an OS keychain; read back only there.
  if (s.enc === 'plain') return cipher.name === 'plain' ? s.v : '';
  try {
    return cipher.name === s.enc ? cipher.decrypt(s.v) : '';
  } catch {
    return '';
  }
}

/** Only the on/off switch: what the payment transaction asks. */
export async function fiscalEnabled(db: DbOrTx): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: KEY.enabled } });
  return row?.value === 'true';
}

export async function resolveFiscalConfig(
  db: DbOrTx,
  cipher: Cipher,
): Promise<ResolvedFiscalConfig> {
  const m = await readAll(db);
  const vat = m.get(KEY.vatMode);
  const port = m.get(KEY.port);
  return {
    enabled: m.get(KEY.enabled) === true,
    host: str(m.get(KEY.host), '127.0.0.1'),
    port: typeof port === 'number' && Number.isInteger(port) ? port : DEFAULT_VCR_PORT,
    login: str(m.get(KEY.login), 'cassir'),
    password: decryptSecret(m.get(KEY.password), cipher),
    codes: {
      vatMode: FISCAL_VAT_MODES.includes(vat as FiscalVatMode)
        ? (vat as FiscalVatMode)
        : 'nonPayer',
      defaultMxik: str(m.get(KEY.defaultMxik), ''),
      defaultPackage: str(m.get(KEY.defaultPackage), ''),
      serviceMxik: str(m.get(KEY.serviceMxik), ''),
      servicePackage: str(m.get(KEY.servicePackage), ''),
      deliveryMxik: str(m.get(KEY.deliveryMxik), ''),
      deliveryPackage: str(m.get(KEY.deliveryPackage), ''),
    },
  };
}

export function toFiscalConfigDto(c: ResolvedFiscalConfig, urlOverride: boolean): FiscalConfigDto {
  return {
    enabled: c.enabled,
    host: c.host,
    port: c.port,
    login: c.login,
    hasPassword: c.password !== '',
    ...c.codes,
    urlOverride,
  };
}

async function put(db: DbOrTx, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await db.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
}

export async function saveFiscalConfig(
  db: DbOrTx,
  cipher: Cipher,
  input: FiscalConfigInput,
): Promise<void> {
  const { password } = input;
  const fields = [
    'enabled',
    'host',
    'port',
    'login',
    'vatMode',
    'defaultMxik',
    'defaultPackage',
    'serviceMxik',
    'servicePackage',
    'deliveryMxik',
    'deliveryPackage',
  ] as const satisfies ReadonlyArray<Exclude<keyof FiscalConfigInput, 'password'>>;
  for (const field of fields) await put(db, KEY[field], input[field]);
  if (password) {
    const secret: StoredSecret = { enc: cipher.name, v: cipher.encrypt(password) };
    await put(db, KEY.password, secret);
  }
}

/**
 * The prefix of every receipt `code` this database sends (VCR's idempotency key), made on first
 * use. Order numbers start again at 2026-00001 on a fresh install; with the same prefix a new
 * check could be taken for a receipt VCR already holds from the old database.
 */
export async function receiptCodePrefix(db: DbOrTx): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: KEY.codePrefix } });
  if (row) {
    try {
      const v = JSON.parse(row.value) as unknown;
      if (typeof v === 'string' && /^[a-f0-9]{8}$/.test(v)) return v;
    } catch {
      // made again below
    }
  }
  // Created, never updated: two first callers must not end up with two prefixes (a receipt sent
  // under the first could then not be found by its code, and would be registered again).
  const made = randomBytes(4).toString('hex');
  try {
    await db.setting.create({ data: { key: KEY.codePrefix, value: JSON.stringify(made) } });
    return made;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return receiptCodePrefix(db);
  }
}

export const receiptCode = (prefix: string, orderNumber: string) => `SC-${prefix}-${orderNumber}`;
