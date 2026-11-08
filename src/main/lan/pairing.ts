import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Pairing a satellite till with this main till (feature F12; posgro local-server/pairing.ts).
 *
 * The owner asks the main till for a code (Settings -> Satellitlar, `settings` permission), reads
 * it off the screen and types it into the satellite, which redeems it for a device secret. A code
 * rather than a password typed on the satellite: it is short-lived, single-use and worthless once
 * redeemed. In memory on purpose: a restart of the main till drops an unredeemed code.
 */

const CODE_DIGITS = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong codes allowed per caller address before it waits (the code is only 6 digits). */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
/**
 * Wrong codes in all, from any address, before the code is cancelled: a caller hopping between
 * addresses on the shop network cannot walk the codes either (the owner then makes a new one).
 */
const MAX_TOTAL_FAILURES = 10;

export interface PairingCode {
  code: string;
  expiresAt: number;
}

export class PairingStore {
  private active: PairingCode | null = null;
  private failures = new Map<string, { count: number; since: number }>();
  private totalFailures = 0;
  /** True once the code was cancelled for too many wrong tries (shown on the main till). */
  burned = false;

  constructor(private readonly clock: () => number = Date.now) {}

  issue(): PairingCode {
    // The CSPRNG: this code is briefly the only thing between the shop's data and its Wi-Fi.
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
    this.active = { code, expiresAt: this.clock() + CODE_TTL_MS };
    this.totalFailures = 0;
    this.burned = false;
    return this.active;
  }

  current(): PairingCode | null {
    if (this.active && this.active.expiresAt <= this.clock()) this.active = null;
    return this.active;
  }

  cancel(): void {
    this.active = null;
  }

  isOpen(): boolean {
    return this.current() !== null;
  }

  /**
   * Checks and consumes the code. Single-use. `from` (the caller's address) is throttled after
   * repeated wrong codes, so the 10^6 codes cannot be walked during the 10 minutes.
   */
  redeem(candidate: string, from: string): 'ok' | 'wrong' | 'throttled' | 'closed' {
    const now = this.clock();
    for (const [addr, f] of this.failures)
      if (now - f.since > FAILURE_WINDOW_MS) this.failures.delete(addr);
    if ((this.failures.get(from)?.count ?? 0) >= MAX_FAILURES) return 'throttled';
    const entry = this.current();
    if (!entry) return 'closed';
    const a = Buffer.from(candidate.trim());
    const b = Buffer.from(entry.code);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      const prev = this.failures.get(from);
      this.failures.set(from, { count: (prev?.count ?? 0) + 1, since: prev?.since ?? now });
      this.totalFailures += 1;
      if (this.totalFailures >= MAX_TOTAL_FAILURES) {
        this.active = null;
        this.burned = true;
      }
      return 'wrong';
    }
    this.active = null;
    this.failures.delete(from);
    return 'ok';
  }
}

/** The satellite's device secret: returned once, kept only as a SHA-256 on the main till. */
export function newDeviceSecret(): string {
  return randomBytes(32).toString('hex');
}

/** 32 random bytes need no slow hash: a fast one does not make them guessable. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
