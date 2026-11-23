import type { AppSettings, OrderDto, SessionDto } from '@shared/types';
import { dec, toMoneyString, type DecimalString } from '@shared/utils/decimal';
import {
  available,
  draftTotal,
  draftUsage,
  priced,
  savedUsage,
  UNLIMITED,
  type DraftLine,
} from '@shared/utils/order-draft';
import { serviceFeeFor } from '@shared/utils/service-fee';

/**
 * The order screen's sums and tags, from the till's own draft code (`@shared/utils/order-draft`)
 * and service-fee rule, so the phone shows what main will save.
 */

/** "Qoldi: n" appears at or below this many left (pieces, portions or kg). */
export const LOW_STOCK = 5;

export type StockTag = { kind: 'low'; left: DecimalString } | { kind: 'out' } | null;

export function stockTag(
  menuItemId: number,
  session: SessionDto | null,
  order: OrderDto | null,
  lines: DraftLine[],
): StockTag {
  const left = available(menuItemId, session, savedUsage(order), draftUsage(lines));
  // Not in the open shift: nothing to sell.
  if (left === null) return { kind: 'out' };
  if (left === UNLIMITED) return null;
  if (dec(left).lte(0)) return { kind: 'out' };
  return dec(left).lte(LOW_STOCK) ? { kind: 'low', left } : null;
}

/**
 * A line the till does not have yet ("Yangi" in the cart): no saved line of the same dish with
 * the same portion or weight, or more of it than was saved.
 */
export function isNewLine(line: DraftLine, order: OrderDto | null): boolean {
  if (!order) return true;
  const same = order.lines.filter(
    (s) =>
      s.menuItemId === line.menuItemId &&
      (s.portion === null ? line.portion === null || line.portion === '1' : dec(s.portion).eq(line.portion ?? '1')) &&
      (s.weightKg === null ? line.weightKg === null : line.weightKg !== null && dec(s.weightKg).eq(line.weightKg)),
  );
  if (same.length === 0) return true;
  const saved = same.reduce((n, s) => n + Number(s.quantity), 0);
  return line.quantity > saved;
}

/** How many lines are new, for "3 ta yangi taom hali oshxonaga yuborilmagan". */
export const newLineCount = (lines: DraftLine[], order: OrderDto | null) =>
  lines.filter((l) => isNewLine(l, order)).length;

export interface Totals {
  dishes: DecimalString;
  fee: DecimalString;
  total: DecimalString;
}

export function totals(lines: DraftLine[], settings: AppSettings | null, guests: number | null): Totals {
  const dishes = draftTotal(lines);
  const fee = settings
    ? toMoneyString(
        serviceFeeFor(
          {
            type: settings.serviceFeeType,
            percent: settings.serviceFeePercent,
            perGuest: settings.serviceFeePerGuest,
          },
          dishes,
          guests,
        ),
      )
    : '0';
  return { dishes, fee, total: toMoneyString(dec(dishes).plus(fee)) };
}

export const lineTotal = (line: DraftLine): DecimalString => toMoneyString(priced(line).totalPrice);

/** Pieces in the order for the bar's "5 ta taom": plain dishes count each, others count 1 a line. */
export function itemCount(lines: DraftLine[]): number {
  return lines.reduce((n, l) => n + (l.soldByWeight ? 1 : l.quantity), 0);
}

/** Portion as the till sends it ("0.7"), weight with a decimal comma ("0,450"). */
export const portionText = (portion: string) => portion;
export const weightText = (kg: DecimalString) => dec(kg).toFixed(3).replace('.', ',');

/** Minutes since `iso` (never negative: the clocks may differ). */
export function minutesSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
}

/** The weight keypad: up to 3 decimals, one comma (stored with "."), at most 99,999 kg. */
export function nextWeightInput(current: string, key: string): string {
  if (key === ',') return current.includes(',') ? current : `${current || '0'},`;
  const next = current === '0' ? key : current + key;
  const [int = '', frac] = next.split(',');
  if (int.length > 2 || (frac !== undefined && frac.length > 3)) return current;
  return next;
}
