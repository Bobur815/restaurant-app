import { dec, sum, type Dec, type DecimalInput } from './decimal';

/**
 * Feature F18: an order as REGOS:VCR's Receipt.Sale wants it (posgro src/main/fiscal,
 * tasks/REGOS_VCR_INTEGRATION.md). Electron-free and pure, so the money rules are pinned by tests:
 *
 * - money in tiyin (so'm x 100) and quantities x 1000, both integers worked out in Decimal;
 * - one position per order line; the service fee and the delivery fee are their own positions
 *   with their own MXIK (decided 2026-11-11, Q3);
 * - `quantity` is the line's stock quantity (portions 0.7 -> 700, weight in kg -> kg x 1000), so
 *   amount / quantity is the price of one full portion or one kilogram;
 * - VAT: a non-payer sends -1 ("Без НДС", REGOS support 2026-06-19); a 12 % payer sends
 *   ceil(amount x 12 / 112): VCR re-derives the rate from it and truncates, so rounding down or to
 *   nearest lands on 11 % and is refused (posgro gotcha);
 * - payments: card -> type 2 (plain bank terminal, card_type 2, no payment_id); cash, Click
 *   (posgro's rule, Q1) and a repaid debt part (Q2, sent once the debt is covered) -> type 1.
 */

export type FiscalVatMode = 'nonPayer' | 'vat12';
export const FISCAL_VAT_MODES = ['nonPayer', 'vat12'] as const satisfies readonly FiscalVatMode[];

export interface VcrPosition {
  name: string;
  barcode: string;
  /** MXIK (IKPU), 17 digits. */
  icps: string;
  package_code?: string;
  /** Tiyin. */
  amount: number;
  /** x 1000. */
  quantity: number;
  /** Tiyin, or -1 for "Без НДС". */
  vat_value: number;
  discount: number;
  owner_type: 'BuyingAndSelling';
}

export interface VcrPayment {
  type: 1 | 2;
  /** Tiyin. */
  value: number;
  card_type?: 2;
}

export interface FiscalCodes {
  vatMode: FiscalVatMode;
  defaultMxik: string;
  defaultPackage: string;
  serviceMxik: string;
  servicePackage: string;
  deliveryMxik: string;
  deliveryPackage: string;
}

export interface FiscalOrderInput {
  lines: Array<{
    menuItemId: number;
    name: string;
    mxik: string | null;
    packageCode: string | null;
    totalPrice: DecimalInput;
    stockQuantity: DecimalInput;
  }>;
  serviceFee: DecimalInput;
  deliveryFee: DecimalInput;
  payments: Array<{ method: 'cash' | 'card' | 'click' | 'debt'; amount: DecimalInput }>;
  /** Shown on the receipt in place of the fee names (the receipt language). */
  labels: { serviceFee: string; deliveryFee: string };
}

export type FiscalReceiptProblem =
  | { reason: 'NO_MXIK'; name: string }
  | { reason: 'EMPTY' }
  | { reason: 'UNBALANCED'; positions: number; payments: number };

export class FiscalReceiptError extends Error {
  constructor(readonly problem: FiscalReceiptProblem) {
    super(
      problem.reason === 'NO_MXIK'
        ? `MXIK kodi kiritilmagan: ${problem.name}`
        : problem.reason === 'EMPTY'
          ? "Chekda pozitsiya yo'q"
          : "Chek summasi to'lovlarga teng emas",
    );
    this.name = 'FiscalReceiptError';
  }
}

export const MXIK_PATTERN = /^\d{17}$/;
/** Barcodes for the fee lines: dishes use their id (000017), so these never collide in practice. */
export const SERVICE_FEE_BARCODE = '999991';
export const DELIVERY_FEE_BARCODE = '999992';

/** So'm -> tiyin, exactly (amounts are stored with at most 2 decimals). */
export function toTiyin(value: DecimalInput): number {
  return dec(value).times(100).toDecimalPlaces(0, 4).toNumber();
}

/** Quantity x 1000 (VCR's unit), at least 1. */
export function toMilli(value: DecimalInput): number {
  return Math.max(1, dec(value).times(1000).toDecimalPlaces(0, 4).toNumber());
}

export function vatValue(amountTiyin: number, mode: FiscalVatMode): number {
  if (mode === 'nonPayer') return -1;
  return dec(amountTiyin).times(12).dividedBy(112).ceil().toNumber();
}

function position(
  name: string,
  barcode: string,
  mxik: string,
  packageCode: string,
  amount: Dec,
  quantity: DecimalInput,
  mode: FiscalVatMode,
): VcrPosition {
  const tiyin = toTiyin(amount);
  const p: VcrPosition = {
    name: name.slice(0, 120),
    barcode,
    icps: mxik,
    amount: tiyin,
    quantity: toMilli(quantity),
    vat_value: vatValue(tiyin, mode),
    discount: 0,
    owner_type: 'BuyingAndSelling',
  };
  // Optional for goods that are not marked: VCR works it out from the MXIK (posgro gotcha).
  if (packageCode) p.package_code = packageCode;
  return p;
}

function codeOr(own: string | null, fallback: string): string {
  return own && own.trim() ? own.trim() : fallback.trim();
}

/** The Receipt.Sale positions and payments of a paid order. Throws FiscalReceiptError. */
export function buildFiscalReceipt(
  order: FiscalOrderInput,
  codes: FiscalCodes,
): { positions: VcrPosition[]; payments: VcrPayment[] } {
  const positions: VcrPosition[] = [];
  for (const line of order.lines) {
    const total = dec(line.totalPrice);
    if (total.lte(0)) continue;
    const mxik = codeOr(line.mxik, codes.defaultMxik);
    if (!MXIK_PATTERN.test(mxik))
      throw new FiscalReceiptError({ reason: 'NO_MXIK', name: line.name });
    // A dish with its own MXIK uses its own package code only (another MXIK's package is wrong).
    const pkg = line.mxik && line.mxik.trim() ? (line.packageCode ?? '') : codes.defaultPackage;
    positions.push(
      position(
        line.name,
        String(line.menuItemId).padStart(6, '0'),
        mxik,
        pkg.trim(),
        total,
        line.stockQuantity,
        codes.vatMode,
      ),
    );
  }
  const fees: Array<[Dec, string, string, string, string]> = [
    [
      dec(order.serviceFee),
      order.labels.serviceFee,
      SERVICE_FEE_BARCODE,
      codes.serviceMxik,
      codes.servicePackage,
    ],
    [
      dec(order.deliveryFee),
      order.labels.deliveryFee,
      DELIVERY_FEE_BARCODE,
      codes.deliveryMxik,
      codes.deliveryPackage,
    ],
  ];
  for (const [amount, name, barcode, mxik, pkg] of fees) {
    if (amount.lte(0)) continue;
    if (!MXIK_PATTERN.test(mxik.trim())) throw new FiscalReceiptError({ reason: 'NO_MXIK', name });
    positions.push(position(name, barcode, mxik.trim(), pkg.trim(), amount, 1, codes.vatMode));
  }
  if (positions.length === 0) throw new FiscalReceiptError({ reason: 'EMPTY' });

  const card = sum(order.payments.filter((p) => p.method === 'card').map((p) => p.amount));
  const other = sum(order.payments.filter((p) => p.method !== 'card').map((p) => p.amount));
  const payments: VcrPayment[] = [];
  if (other.gt(0)) payments.push({ type: 1, value: toTiyin(other) });
  if (card.gt(0)) payments.push({ type: 2, value: toTiyin(card), card_type: 2 });

  const posTotal = positions.reduce((s, p) => s + p.amount, 0);
  const payTotal = payments.reduce((s, p) => s + p.value, 0);
  if (posTotal !== payTotal) {
    throw new FiscalReceiptError({ reason: 'UNBALANCED', positions: posTotal, payments: payTotal });
  }
  return { positions, payments };
}
