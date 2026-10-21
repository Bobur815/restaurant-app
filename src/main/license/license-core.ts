import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { IpcChannel } from '@shared/ipc';
import {
  LICENSE_FEATURES,
  type LicenseFeature,
  type LicensePlan,
  type LicenseReason,
  type TillMode,
} from '@shared/license';

/**
 * Feature F5, pure: reading the posgro server's licence and deciding what this till may do. No
 * Electron, no database: `now` is the trusted clock's (trusted-clock.ts), passed in.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** A till set up before F5 works this long unlinked, from its first start with F5. */
export const UNLINKED_ALLOWANCE_DAYS = 14;

/** What posgro signs (src/server/modules/savdochef/savdochef-license.ts). */
export interface LicensePayload {
  v: 1;
  product: 'SAVDOCHEF';
  storeId: string;
  storeName: string;
  plan: string | null;
  expiresAt: string | null;
  warnFrom: string | null;
  blockAt: string | null;
  issuedAt: string;
  checkinBy: string;
  terminals?: number;
  seats?: string[];
  features: LicenseFeature[];
  trialEndsAt?: string;
}

export function publicKeyFrom(base64Der: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'spki' });
}

const isDate = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isDateOrNull = (v: unknown) => v === null || isDate(v);

/** The payload of `<payload>.<sig>` signed by `key` for SavdoChef, or null. */
export function readLicense(token: unknown, key: KeyObject): LicensePayload | null {
  if (typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const bytes = Buffer.from(body, 'base64url');
    if (!verify(null, bytes, key, Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    const ok =
      p['v'] === 1 &&
      p['product'] === 'SAVDOCHEF' &&
      typeof p['storeId'] === 'string' &&
      p['storeId'] !== '' &&
      typeof p['storeName'] === 'string' &&
      (p['plan'] === null || typeof p['plan'] === 'string') &&
      isDateOrNull(p['expiresAt']) &&
      isDateOrNull(p['warnFrom']) &&
      isDateOrNull(p['blockAt']) &&
      isDate(p['issuedAt']) &&
      isDate(p['checkinBy']) &&
      Array.isArray(p['features']) &&
      (p['seats'] === undefined ||
        (Array.isArray(p['seats']) && p['seats'].every((s) => typeof s === 'string')));
    if (!ok) return null;
    return {
      ...(p as unknown as LicensePayload),
      // Only names this build knows; an unknown one switches nothing on.
      features: LICENSE_FEATURES.filter((f) => (p['features'] as unknown[]).includes(f)),
    };
  } catch {
    return null;
  }
}

export interface TillState {
  mode: TillMode;
  reason: LicenseReason;
  features: LicenseFeature[];
  daysLeft: number | null;
  plan: LicensePlan | null;
}

/** Where this till stands at `now` (its trusted clock). Blocked outranks an overdue check-in. */
export function tillState(input: {
  license: LicensePayload | null;
  setupComplete: boolean;
  firstRunAt: Date;
  terminalId: string;
  now: number;
}): TillState {
  const { license, now } = input;
  const daysUntil = (ms: number) => Math.max(0, Math.ceil((ms - now) / DAY_MS));
  const all = [...LICENSE_FEATURES];

  if (!license) {
    if (!input.setupComplete)
      return { mode: 'setup', reason: 'setup', features: all, daysLeft: null, plan: null };
    const end = input.firstRunAt.getTime() + UNLINKED_ALLOWANCE_DAYS * DAY_MS;
    return now < end
      ? {
          mode: 'full',
          reason: 'unlinked-allowance',
          features: all,
          daysLeft: daysUntil(end),
          plan: null,
        }
      : { mode: 'readonly', reason: 'unlinked', features: all, daysLeft: 0, plan: null };
  }

  const at = Date.parse;
  const plan =
    (['TRIAL', 'STARTER', 'PRO', 'VIP'] as const).find((p) => p === license.plan) ?? null;
  const base = { features: license.features, plan };
  if (license.blockAt && now >= at(license.blockAt)) {
    return { ...base, mode: 'readonly', reason: 'blocked', daysLeft: 0 };
  }
  if (now >= at(license.checkinBy))
    return { ...base, mode: 'readonly', reason: 'checkin-required', daysLeft: 0 };
  if (license.seats && !license.seats.includes(input.terminalId)) {
    return { ...base, mode: 'readonly', reason: 'no-seat', daysLeft: null };
  }
  const { expiresAt, warnFrom, blockAt } = license;
  if (!expiresAt || !warnFrom || !blockAt)
    return { ...base, mode: 'full', reason: 'unlimited', daysLeft: null };
  if (now < at(warnFrom)) {
    return {
      ...base,
      mode: 'full',
      reason: plan === 'TRIAL' ? 'trial' : 'active',
      daysLeft: daysUntil(at(expiresAt)),
    };
  }
  if (now < at(expiresAt))
    return { ...base, mode: 'full', reason: 'warning', daysLeft: daysUntil(at(expiresAt)) };
  return { ...base, mode: 'full', reason: 'grace', daysLeft: daysUntil(at(blockAt)) };
}

// ── What the till refuses ──────────────────────────────────────────────────────────────────

/**
 * New business: refused while read-only. Paying, cash in/out of the open shift's drawer, X/Z
 * reports, closing, reports and settings stay open (a till blocked mid-shift must still count out).
 */
export const READONLY_REFUSED: ReadonlySet<IpcChannel> = new Set<IpcChannel>([
  'orders:save',
  'orders:saveOpen',
  'sessions:open',
  'residuals:apply',
  'categories:create',
  'categories:update',
  'categories:delete',
  'menu:create',
  'menu:update',
  'menu:delete',
  'menu:pickImage',
]);

const READONLY_MESSAGE: Record<string, string> = {
  blocked: "Obuna muddati tugagan: yangi buyurtma va smena ochib bo'lmaydi. Sozlamalar → Obuna",
  'checkin-required':
    "Dastur 14 kundan beri internetga ulanmagan: yangi buyurtma va smena ochib bo'lmaydi. Internetga ulang va Sozlamalar → Obuna → «Hozir tekshirish»",
  'no-seat':
    "Tarifdagi kassalar soni tugagan: bu kassada yangi buyurtma va smena ochib bo'lmaydi. Sozlamalar → Obuna",
  unlinked:
    "Restoran ulanmagan: yangi buyurtma va smena ochib bo'lmaydi. Sozlamalar → Obuna → «Restoranni ulash»",
};

const FEATURE_MESSAGE: Record<LicenseFeature, string> = {
  takeaway: "«Olib ketish» buyurtmalari tarifingizda yo'q (Pro tarifida bor)",
  delivery: "«Yetkazib berish» buyurtmalari tarifingizda yo'q (Pro tarifida bor)",
  debt: "Nasiyaga sotish tarifingizda yo'q (Pro tarifida bor)",
  reports: "Bir kundan uzun hisobotlar tarifingizda yo'q (Pro tarifida bor)",
  multiHall: "Bir nechta zal tarifingizda yo'q (VIP tarifida bor)",
  receiptLogos: "Chekdagi rasmlar tarifingizda yo'q (VIP tarifida bor)",
};

type AnyInput = Record<string, unknown> | undefined;

/** Active halls, not counting `excludeId` (the hall being switched back on). */
export type ActiveHalls = (excludeId?: number) => Promise<number>;

/** Whether a payment's tenders sell anything on debt (a debt line of zero sells nothing). */
export function sellsOnDebt(input: AnyInput): boolean {
  const tenders = Array.isArray(input?.['tenders'])
    ? (input!['tenders'] as Array<{ method?: unknown; amount?: unknown }>)
    : [];
  return (
    input?.['method'] === 'debt' ||
    tenders.some((t) => t.method === 'debt' && Number(t.amount ?? 0) > 0)
  );
}

/** The feature a call needs, given its (parsed) input; null when it needs none. */
export function featureNeeded(
  channel: IpcChannel,
  input: AnyInput,
  activeHalls: ActiveHalls,
): Promise<LicenseFeature | null> | LicenseFeature | null {
  switch (channel) {
    case 'orders:saveOpen':
      // Also when editing: the type of an existing order can be changed on save.
      return input?.['orderType'] === 'DELIVERY' ? 'delivery' : 'takeaway';
    case 'payments:pay':
    case 'checks:update':
      return sellsOnDebt(input) ? 'debt' : null;
    case 'reports:sales':
      return input?.['start'] === input?.['end'] ? null : 'reports';
    case 'receipt:updateLayout':
      return input?.['topImage'] || input?.['bottomImage'] ? 'receiptLogos' : null;
    case 'halls:create':
      return activeHalls().then((n) => (n >= 1 ? 'multiHall' : null));
    case 'halls:update':
      // Switching a hidden hall back on is a second hall too.
      if (input?.['isActive'] !== true) return null;
      return activeHalls(input['id'] as number).then((n) => (n >= 1 ? 'multiHall' : null));
    default:
      return null;
  }
}

/**
 * The Uzbek reason a call is refused at `state`, or null to let it through. Checked in main on
 * every call (ipc-safe.ts), after the input is parsed; hiding a button is only a courtesy.
 */
export async function refusal(
  channel: IpcChannel,
  input: unknown,
  state: TillState,
  activeHalls: ActiveHalls,
): Promise<string | null> {
  if (state.mode === 'setup') {
    // Nobody can sign in before setup; refused anyway, in case that ever changes.
    if (channel === 'setup:complete' || READONLY_REFUSED.has(channel)) {
      return 'Avval restoraningizni ulang (internet kerak)';
    }
    return null;
  }
  if (state.mode === 'readonly' && READONLY_REFUSED.has(channel)) {
    return READONLY_MESSAGE[state.reason] ?? READONLY_MESSAGE['blocked']!;
  }
  const feature = await featureNeeded(channel, input as AnyInput, activeHalls);
  if (feature && !state.features.includes(feature)) return FEATURE_MESSAGE[feature];
  return null;
}
