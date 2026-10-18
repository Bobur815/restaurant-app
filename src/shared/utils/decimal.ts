import Decimal from 'decimal.js';

/**
 * The one place money and quantity arithmetic happens (main and renderer alike).
 *
 * Rules (decided 2026-10-18, money stays Decimal):
 * - Values cross IPC as decimal strings ("12500.5"), never JS numbers. Prisma.Decimal is
 *   converted with `dec(value)` on the way out of the database and back.
 * - Money: 2 decimal places, ROUND_HALF_UP (so'm, as legacy `roundN`).
 * - Quantities: 3 decimal places, ROUND_HALF_UP (grams for weight dishes; legacy used 2).
 * - Round once, when a value is stored or shown; never round intermediate results.
 */

export const MONEY_DP = 2;
export const QTY_DP = 3;

/** Isolated configuration, so nothing else that uses decimal.js can change our rounding. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

/** A plain decimal number as text: optional minus, digits, optional fraction. No exponent. */
export type DecimalString = string;
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Anything with a decimal toString(): Prisma.Decimal, decimal.js from another copy, numbers. */
export type DecimalInput = string | number | Dec | { toString(): string };

export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === 'string' && DECIMAL_STRING.test(value);
}

/** Parses strictly: throws on '', NaN, Infinity, '1e5', ' 1', null. */
export function dec(value: DecimalInput): Dec {
  if (value instanceof D) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
    return new D(value);
  }
  if (value === null || value === undefined) throw new TypeError('Decimal value is missing');
  const text = typeof value === 'string' ? value : value.toString();
  if (!isDecimalString(text)) throw new RangeError(`Not a decimal string: "${text}"`);
  return new D(text);
}

export function roundMoney(value: DecimalInput): Dec {
  return dec(value).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

export function roundQty(value: DecimalInput): Dec {
  return dec(value).toDecimalPlaces(QTY_DP, Decimal.ROUND_HALF_UP);
}

/** Money for IPC/storage: rounded, minimal form ("12500", "12500.5"), never exponent notation. */
export function toMoneyString(value: DecimalInput): DecimalString {
  return roundMoney(value).toFixed();
}

export function toQtyString(value: DecimalInput): DecimalString {
  return roundQty(value).toFixed();
}

export function sum(values: Iterable<DecimalInput>): Dec {
  let total = new D(0);
  for (const v of values) total = total.plus(dec(v));
  return total;
}

export function isZero(value: DecimalInput): boolean {
  return dec(value).isZero();
}
