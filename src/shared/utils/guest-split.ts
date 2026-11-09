import { dec, sum, type DecimalString } from './decimal';
import { TENDER_METHODS, type TenderLine, type TenderMethod } from './split-payment';

/**
 * Feature F14: one check divided between guests, each paying a share with their own method.
 * Only a way of entering tenders: the shares are added up per method into the same `tenders`
 * main stores (one payment row per method), checked by `settleTenders` as any split payment.
 *
 * Shares are whole so'm where the total allows: 25 000 / 3 = 8 334 + 8 333 + 8 333 (the
 * remainder goes to the first guests; any tiyin of the total to the first guest). They always add
 * up to the total exactly. A share typed by hand is "fixed"; the rest is divided among the others.
 */

export const MIN_GUESTS = 2;
export const MAX_GUESTS = 20;

export interface GuestShare {
  share: DecimalString;
  /** Typed by hand: kept when the others are divided again. */
  fixed: boolean;
  method: TenderMethod;
}

/** `n` shares of `total`, whole so'm first, adding up to `total` exactly. */
export function equalShares(total: DecimalString, n: number): DecimalString[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Bad guest count: ${n}`);
  const t = dec(total);
  const base = t.dividedBy(n).floor();
  let rest = t.minus(base.times(n)); // < n, may have a fractional part
  const shares = Array.from({ length: n }, () => base);
  for (let i = 0; i < n && rest.gte(1); i++) {
    shares[i] = shares[i]!.plus(1);
    rest = rest.minus(1);
  }
  if (rest.gt(0)) shares[0] = shares[0]!.plus(rest);
  return shares.map((s) => s.toFixed());
}

export type RebalanceProblem = 'none' | 'over' | 'short';

/**
 * Keeps the fixed shares and divides what is left of the total equally among the others.
 * `over`: the fixed shares alone exceed the total (the others get 0). `short`: every share is
 * fixed and together they do not reach the total.
 */
export function rebalance(
  total: DecimalString,
  guests: readonly GuestShare[],
): { guests: GuestShare[]; problem: RebalanceProblem } {
  const fixedSum = sum(guests.filter((g) => g.fixed).map((g) => g.share));
  const free = guests.filter((g) => !g.fixed).length;
  const left = dec(total).minus(fixedSum);
  if (left.lt(0)) {
    return {
      guests: guests.map((g) => (g.fixed ? { ...g } : { ...g, share: '0' })),
      problem: 'over',
    };
  }
  if (free === 0) {
    return { guests: guests.map((g) => ({ ...g })), problem: left.gt(0) ? 'short' : 'none' };
  }
  const shares = equalShares(left.toFixed(), free);
  let i = 0;
  return {
    guests: guests.map((g) => (g.fixed ? { ...g } : { ...g, share: shares[i++]! })),
    problem: 'none',
  };
}

/** What main stores: each method once, the guests' shares added up, in TENDER_METHODS order. */
export function guestTenders(guests: readonly GuestShare[]): TenderLine[] {
  return TENDER_METHODS.flatMap((method): TenderLine[] => {
    const shares = guests.filter((g) => g.method === method).map((g) => g.share);
    if (shares.length === 0) return [];
    const total = sum(shares);
    return total.gt(0) ? [{ method, amount: total.toFixed() }] : [];
  });
}

/** Cash handed back to one guest: what they gave over their share, or 0. */
export function guestChange(share: DecimalString, gave: DecimalString | null): DecimalString {
  if (gave === null) return '0';
  const d = dec(gave).minus(share);
  return d.gt(0) ? d.toFixed() : '0';
}
