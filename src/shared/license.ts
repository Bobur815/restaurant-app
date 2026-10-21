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
] as const;
export type LicenseFeature = (typeof LICENSE_FEATURES)[number];

/** Plan ids as the server names them; SavdoChef shows STARTER as "Start". */
export type LicensePlan = 'TRIAL' | 'STARTER' | 'PRO' | 'VIP';

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
  payment: { supportPhone: string; paymentUrl: string } | null;
}

export interface LicensePlanDto {
  id: 'STARTER' | 'PRO' | 'VIP';
  label: string;
  price: number;
  period: 'month' | 'once';
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
