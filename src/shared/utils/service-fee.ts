import { dec, type Dec, type DecimalInput } from './decimal';

/**
 * Feature F17: the service fee (xizmat haqi) on a table order. Main computes it on every save
 * from the settings of that moment and stores it (orders.serviceFee, part of totalAmount); the
 * order screen uses the same function only to show it before the save.
 */

export const SERVICE_FEE_TYPES = ['off', 'percent', 'perGuest'] as const;
export type ServiceFeeType = (typeof SERVICE_FEE_TYPES)[number];

export interface ServiceFeeRule {
  type: ServiceFeeType;
  /** Percent of the dishes total, "0".."100". */
  percent: DecimalInput;
  /** So'm per guest. */
  perGuest: DecimalInput;
}

/** Guests counted when the waiter did not say (the per-guest fee needs at least one). */
export const DEFAULT_GUESTS = 1;
export const MAX_GUESTS_AT_TABLE = 99;

/** Whole so'm, half up (decimal.ts rounds half up): the fee is paid in cash, no tiyin. */
const wholeSom = (v: Dec) => v.toDecimalPlaces(0);

/**
 * The fee for an order whose dishes come to `dishesTotal`. Only table (dine-in) orders carry one;
 * an empty order carries none (nothing was served).
 */
export function serviceFeeFor(
  rule: ServiceFeeRule,
  dishesTotal: DecimalInput,
  guests: number | null | undefined,
): Dec {
  const dishes = dec(dishesTotal);
  if (dishes.lte(0)) return dec(0);
  switch (rule.type) {
    case 'percent':
      return wholeSom(dishes.times(dec(rule.percent)).div(100));
    case 'perGuest':
      return wholeSom(dec(rule.perGuest).times(guests && guests > 0 ? guests : DEFAULT_GUESTS));
    default:
      return dec(0);
  }
}
