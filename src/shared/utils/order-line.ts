import { dec, roundMoney, roundQty, type Dec, type DecimalInput } from './decimal';

/**
 * Price and stock maths for one order line: the single definition, used by the main process to
 * price and stock orders and by the order screen to show live totals. Legacy computed these in
 * three different ways (create / update / cancel) and in the renderer; see tasks/inventory.md
 * quirks 1 and 3.
 *
 * Legacy semantics, kept:
 * - plain dish:   quantity units at `price` each; takes `quantity` from stock.
 * - portion dish: quantity × portion factor (1, 0.7, 0.5); takes quantity × factor.
 * - weight dish:  `price` is per kg; quantity units of `weightKg` kg each;
 *                 takes quantity × weightKg kg from stock.
 */

export const PORTION_FACTORS = ['1', '0.7', '0.5'] as const;
export type PortionFactor = (typeof PORTION_FACTORS)[number];

export interface DishPricing {
  price: DecimalInput;
  hasPortions: boolean;
  soldByWeight: boolean;
}

export interface LineInput {
  quantity: DecimalInput;
  /** Required for portion dishes, forbidden otherwise. */
  portion?: DecimalInput | null;
  /** Kilograms per unit; required for weight dishes, forbidden otherwise. */
  weightKg?: DecimalInput | null;
}

export interface PricedLine {
  quantity: Dec;
  portion: Dec | null;
  weightKg: Dec | null;
  /** Price of one unit as sold (portion or weight applied), money-rounded. */
  unitPrice: Dec;
  /** quantity × unit, money-rounded once from the unrounded product. */
  totalPrice: Dec;
  /** What this line takes from the session stock, quantity-rounded. */
  stockQuantity: Dec;
}

export class LineError extends Error {
  constructor(
    message: string,
    readonly field: 'quantity' | 'portion' | 'weightKg',
  ) {
    super(message);
    this.name = 'LineError';
  }
}

export function isPortionFactor(value: DecimalInput): boolean {
  const v = dec(value);
  return PORTION_FACTORS.some((f) => dec(f).equals(v));
}

export function priceLine(dish: DishPricing, line: LineInput): PricedLine {
  const quantity = dec(line.quantity);
  if (!quantity.isInteger() || quantity.lte(0)) {
    throw new LineError("Miqdor musbat butun son bo'lishi kerak", 'quantity');
  }
  const price = dec(dish.price);

  if (dish.soldByWeight) {
    if (line.portion != null)
      throw new LineError('Vazn bilan sotiladigan taomda porsiya yo‘q', 'portion');
    if (line.weightKg == null) throw new LineError('Vaznni kiriting (kg)', 'weightKg');
    const weightKg = roundQty(line.weightKg);
    if (weightKg.lte(0)) throw new LineError("Vazn musbat bo'lishi kerak", 'weightKg');
    return {
      quantity,
      portion: null,
      weightKg,
      unitPrice: roundMoney(price.times(weightKg)),
      totalPrice: roundMoney(price.times(weightKg).times(quantity)),
      stockQuantity: roundQty(quantity.times(weightKg)),
    };
  }

  if (line.weightKg != null) throw new LineError('Bu taom vazn bilan sotilmaydi', 'weightKg');

  if (dish.hasPortions) {
    const portion = dec(line.portion ?? '1');
    if (!isPortionFactor(portion)) {
      throw new LineError(`Porsiya faqat ${PORTION_FACTORS.join(', ')} bo'lishi mumkin`, 'portion');
    }
    return {
      quantity,
      portion,
      weightKg: null,
      unitPrice: roundMoney(price.times(portion)),
      totalPrice: roundMoney(price.times(portion).times(quantity)),
      stockQuantity: roundQty(quantity.times(portion)),
    };
  }

  if (line.portion != null && !dec(line.portion).equals(1)) {
    throw new LineError('Bu taom porsiyalab sotilmaydi', 'portion');
  }
  return {
    quantity,
    portion: null,
    weightKg: null,
    unitPrice: roundMoney(price),
    totalPrice: roundMoney(price.times(quantity)),
    stockQuantity: roundQty(quantity),
  };
}
