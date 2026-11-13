/**
 * Feature F5: what the posgro server's licence lets this till do. Shared by main (which enforces
 * it) and the renderer (which only explains it). The server's copy of the feature list is
 * posgro `src/server/modules/savdochef/savdochef-config.ts`; keep the names in step.
 */

export const LICENSE_FEATURES = [
  'takeaway',
  'delivery',
  'debt',
  'reports',
  'multiHall',
  'receiptLogos',
  // Pro's modules: the server already sells them, nothing on this till uses them yet.
  'warehouse',
  'inventory',
  'writeOff',
  'recipes',
  'telegramBot',
] as const;
export type LicenseFeature = (typeof LICENSE_FEATURES)[number];

/** In a plan already, not built on the till yet: shown as "coming soon". */
export const UPCOMING_FEATURES: readonly LicenseFeature[] = [
  'warehouse',
  'inventory',
  'writeOff',
  'recipes',
  'telegramBot',
];

/**
 * Plan ids as the server names them (F19): Start, Standard, Pro monthly and a VIP of each (its
 * plan's features and tills, never expires). Before F19 the server's PRO was today's Standard and
 * VIP today's Pro VIP; posgro renamed them on its side, so a licence never says PRO meaning
 * Standard after that. A licence signed before the rename may still say VIP: read as PRO_VIP.
 */
export const LICENSE_PLANS = [
  'TRIAL',
  'STARTER',
  'STANDARD',
  'PRO',
  'STARTER_VIP',
  'STANDARD_VIP',
  'PRO_VIP',
] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];

/** A plan id from the server as this build knows it, or null. */
export function knownPlan(raw: unknown): LicensePlan | null {
  if (raw === 'VIP') return 'PRO_VIP';
  return (LICENSE_PLANS as readonly unknown[]).includes(raw) ? (raw as LicensePlan) : null;
}

/**
 * How the till may work right now:
 * - `full`: everything its plan includes;
 * - `readonly`: open orders can be paid and closed, the shift closed and reports read, but no new
 *   orders, shifts or menu changes;
 * - `setup`: a fresh install that has not linked a restaurant yet (only the setup wizard works).
 */
export type TillMode = 'full' | 'readonly' | 'setup';

/** Why the till is where it is (the renderer words it; main decides it). */
export type LicenseReason =
  | 'active'
  | 'trial'
  | 'warning'
  | 'grace'
  | 'unlimited'
  | 'blocked'
  | 'checkin-required'
  | 'no-seat'
  /** Set up before F5 and not linked yet: works for 14 days from the first start with F5. */
  | 'unlinked-allowance'
  | 'unlinked'
  | 'setup';

export interface LicenseStatusDto {
  mode: TillMode;
  reason: LicenseReason;
  linked: boolean;
  storeId: string | null;
  storeName: string | null;
  plan: LicensePlan | null;
  features: LicenseFeature[];
  /** Days until the next cut-off (expiry, block or the end of the unlinked allowance). */
  daysLeft: number | null;
  expiresAt: string | null;
  trialEndsAt: string | null;
  lastCheckinAt: string | null;
  /** The till must reach the server by then. */
  checkinBy: string | null;
  terminalId: string;
  /** Uzbek, from the last failed check-in. */
  lastError: string | null;
  /** How to pay, from the last check-in (feature F7); null before the first one. */
  payment: LicensePaymentDto | null;
  /** The restaurant's balance and bill as of `account.asOf`; null until the server sends one. */
  account: LicenseAccountDto | null;
}

export interface LicensePaymentDto {
  supportPhone: string;
  /** Self-service pay link (Click/Payme), already holding the store id. */
  paymentUrl: string;
  /** Raw bank-transfer string, drawn as a QR on the till. */
  qrPayload: string;
  /** The card to transfer to (feature F8); null when the server sends none. */
  card: LicensePaymentCardDto | null;
}

export interface LicensePaymentCardDto {
  /** 16 digits, no spaces. */
  number: string;
  holder: string;
  /**
   * The card picture (number and holder drawn on it by the dashboard) as a file name for
   * `savdochef-img://img/<name>`; null until it has been downloaded.
   */
  image: string | null;
}

export type LicenseMovementType = 'TOPUP' | 'SUBSCRIPTION' | 'ADJUSTMENT';

/** Money as decimal strings (UZS), like everything else across IPC. */
export interface LicenseAccountDto {
  balance: string;
  /** The plan's monthly fee; null when not billed (trial, VIP). */
  monthlyFee: string | null;
  /** When the next fee is taken (the paid-until date). */
  nextChargeAt: string | null;
  /** Charged and not covered: what to pay before the month renews. */
  owed: string;
  /** When the server said so: the till may have been offline since. */
  asOf: string;
  /** Latest first. */
  movements: { type: LicenseMovementType; amount: string; balanceAfter: string; at: string }[];
}

export interface LicensePlanDto {
  id: Exclude<LicensePlan, 'TRIAL'>;
  label: string;
  price: number;
  period: 'month' | 'once';
  /** A VIP: no price, the super admin gives it. */
  assignedOnly: boolean;
  /** Null = unlimited tills. */
  terminals: number | null;
  features: LicenseFeature[];
}

export interface LicensePlansDto {
  trial: { enabled: boolean; days: number };
  checkinDays: number;
  plans: LicensePlanDto[];
  extraTerminalPrice: number;
  supportPhone: string;
}

export interface SignupStartDto {
  verificationId: string;
  /** https://t.me/<bot>?start=sc_<token>; null when the server has no bot (staging). */
  botLink: string | null;
  expiresAt: string;
}
