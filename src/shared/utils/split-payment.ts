import type { DecimalString } from './decimal';
import { dec, sum, type Dec } from './decimal';

/**
 * Split payment (from posgro, with Decimal instead of tiyin floats): one check paid with several
 * methods, one payment row per method. The payment modal and main run this same code, so the
 * screen can never accept what main refuses.
 *
 * Rules:
 * - the lines must cover the total;
 * - only cash may go over it: the excess is change handed back, not stored;
 * - card, Click and debt together never exceed the total (a card terminal cannot give change,
 *   and nobody owes more than the check);
 * - several lines of one method are added up; empty (0) lines are ignored.
 */

export const TENDER_METHODS = ['cash', 'card', 'click', 'debt'] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

export interface TenderLine {
  method: TenderMethod;
  amount: DecimalString;
}

export type SplitProblem = 'none' | 'empty' | 'short' | 'nonCashOver';

export interface SplitState {
  /** Sum of the lines as entered (cash may include change still to hand back). */
  entered: DecimalString;
  /** total - entered, never below 0. */
  remaining: DecimalString;
  /** Cash handed back: entered - total when the lines go over it. */
  change: DecimalString;
  /** One line per method, cash net of change, in TENDER_METHODS order: what is stored. */
  applied: TenderLine[];
  problem: SplitProblem;
}

const str = (d: Dec): DecimalString => d.toFixed();

export function settleTenders(total: DecimalString, lines: readonly TenderLine[]): SplitState {
  const byMethod = new Map<TenderMethod, Dec>();
  for (const line of lines) {
    const amount = dec(line.amount);
    if (amount.lte(0)) continue;
    byMethod.set(line.method, (byMethod.get(line.method) ?? dec(0)).plus(amount));
  }
  const due = dec(total);
  // A free check (only 0-priced dishes) is paid by a 0 line, so it can be closed like any other.
  if (due.eq(0)) {
    return {
      entered: '0',
      remaining: '0',
      change: '0',
      // Nothing is owed on a free check: a 0 debt line becomes cash.
      applied: [
        { method: lines[0] && lines[0].method !== 'debt' ? lines[0].method : 'cash', amount: '0' },
      ],
      problem: 'none',
    };
  }
  const entered = sum(byMethod.values());
  const nonCash = sum([...byMethod.entries()].filter(([m]) => m !== 'cash').map(([, a]) => a));
  const remaining = due.minus(entered);
  const change = entered.gt(due) ? entered.minus(due) : dec(0);

  const problem: SplitProblem =
    byMethod.size === 0
      ? 'empty'
      : nonCash.gt(due)
        ? 'nonCashOver'
        : remaining.gt(0)
          ? 'short'
          : 'none';

  // nonCash <= total, so any excess is covered by the cash line.
  const applied = TENDER_METHODS.flatMap((method): TenderLine[] => {
    const amount = byMethod.get(method);
    if (!amount) return [];
    const net = method === 'cash' ? amount.minus(change) : amount;
    return net.gt(0) ? [{ method, amount: str(net) }] : [];
  });

  return {
    entered: str(entered),
    remaining: str(remaining.gt(0) ? remaining : dec(0)),
    change: str(change),
    applied: problem === 'none' ? applied : [],
    problem,
  };
}
