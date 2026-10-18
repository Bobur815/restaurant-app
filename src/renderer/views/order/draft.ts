import type { SaveTableOrderInput } from '@shared/schemas';
import type { MenuItemDto, OrderDto, SessionDto } from '@shared/types';
import { dec, sum, toMoneyString, toQtyString, type DecimalString } from '@shared/utils/decimal';
import { priceLine, type PortionFactor } from '@shared/utils/order-line';

/**
 * The order screen's unsaved state: pure functions over an immutable list of lines. Prices come
 * from the same `priceLine` the server uses, so the total shown is the total that will be saved.
 */

export interface DraftLine {
  key: string;
  menuItemId: number;
  nameUz: string;
  nameRu: string | null;
  imageFile: string | null;
  price: DecimalString;
  hasPortions: boolean;
  soldByWeight: boolean;
  quantity: number;
  portion: PortionFactor | null;
  weightKg: DecimalString | null;
}

let seq = 0;
const nextKey = () => `l${++seq}`;

type Dish = Pick<
  MenuItemDto,
  'id' | 'nameUz' | 'nameRu' | 'imageFile' | 'price' | 'hasPortions' | 'soldByWeight'
>;

function lineFor(dish: Dish, extra: Partial<DraftLine> = {}): DraftLine {
  return {
    key: nextKey(),
    menuItemId: dish.id,
    nameUz: dish.nameUz,
    nameRu: dish.nameRu,
    imageFile: dish.imageFile,
    price: dish.price,
    hasPortions: dish.hasPortions,
    soldByWeight: dish.soldByWeight,
    quantity: 1,
    portion: dish.hasPortions ? '1' : null,
    weightKg: null,
    ...extra,
  };
}

/**
 * Adds one of a dish. A plain dish, or a full portion, bumps an existing identical line; a weight
 * dish always starts a new line (it needs its own weight, given by the caller).
 */
export function addDish(lines: DraftLine[], dish: Dish, weightKg?: DecimalString): DraftLine[] {
  if (dish.soldByWeight) {
    if (!weightKg) throw new Error('weight dish needs weightKg');
    return [...lines, lineFor(dish, { weightKg: toQtyString(weightKg) })];
  }
  const same = lines.find(
    (l) =>
      l.menuItemId === dish.id && !l.soldByWeight && l.portion === (dish.hasPortions ? '1' : null),
  );
  if (same) return setQuantity(lines, same.key, same.quantity + 1);
  return [...lines, lineFor(dish)];
}

export const MAX_QTY = 999;

export function setQuantity(lines: DraftLine[], key: string, quantity: number): DraftLine[] {
  const q = Math.max(1, Math.min(MAX_QTY, Math.trunc(quantity) || 1));
  return lines.map((l) => (l.key === key ? { ...l, quantity: q } : l));
}

export function setPortion(lines: DraftLine[], key: string, portion: PortionFactor): DraftLine[] {
  return lines.map((l) => (l.key === key && l.hasPortions ? { ...l, portion } : l));
}

export function setWeight(lines: DraftLine[], key: string, weightKg: DecimalString): DraftLine[] {
  return lines.map((l) =>
    l.key === key && l.soldByWeight ? { ...l, weightKg: toQtyString(weightKg) } : l,
  );
}

export function removeLine(lines: DraftLine[], key: string): DraftLine[] {
  return lines.filter((l) => l.key !== key);
}

export function priced(line: DraftLine) {
  return priceLine(
    { price: line.price, hasPortions: line.hasPortions, soldByWeight: line.soldByWeight },
    { quantity: line.quantity, portion: line.portion, weightKg: line.weightKg },
  );
}

export function draftTotal(lines: DraftLine[]): DecimalString {
  return toMoneyString(sum(lines.map((l) => priced(l).totalPrice)));
}

/** Stock each dish's lines take, by menu item. */
export function stockUsage(lines: Array<Pick<DraftLine, 'menuItemId'> & { stock: DecimalString }>) {
  const usage = new Map<number, DecimalString>();
  for (const l of lines)
    usage.set(
      l.menuItemId,
      dec(usage.get(l.menuItemId) ?? '0')
        .plus(l.stock)
        .toFixed(),
    );
  return usage;
}

export const draftUsage = (lines: DraftLine[]) =>
  stockUsage(
    lines.map((l) => ({ menuItemId: l.menuItemId, stock: priced(l).stockQuantity.toFixed() })),
  );

export const savedUsage = (order: OrderDto | null) =>
  stockUsage(
    (order?.lines ?? []).map((l) => ({ menuItemId: l.menuItemId, stock: l.stockQuantity })),
  );

/**
 * What is still free for this dish while editing this table: the shift's remaining stock, plus
 * what this order already holds (saved lines will be given back on save), minus the draft.
 * null when the dish is not in the open shift. The server checks again on save.
 */
export function available(
  menuItemId: number,
  session: SessionDto | null,
  saved: Map<number, DecimalString>,
  draft: Map<number, DecimalString>,
): DecimalString | null {
  const item = session?.items.find((i) => i.menuItemId === menuItemId);
  if (!item) return null;
  return toQtyString(
    dec(item.remainingQuantity)
      .plus(saved.get(menuItemId) ?? '0')
      .minus(draft.get(menuItemId) ?? '0'),
  );
}

export function fromOrder(order: OrderDto, menu: MenuItemDto[]): DraftLine[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  return order.lines.map((l) => {
    const dish = byId.get(l.menuItemId);
    return {
      key: nextKey(),
      menuItemId: l.menuItemId,
      nameUz: l.nameUz,
      nameRu: l.nameRu,
      imageFile: l.imageFile,
      // Current menu price: the server reprices on save, so show what will be charged.
      price: dish?.price ?? l.unitPrice,
      hasPortions: l.hasPortions,
      soldByWeight: l.soldByWeight,
      quantity: Number(l.quantity),
      portion: (l.portion as PortionFactor | null) ?? (l.hasPortions ? '1' : null),
      weightKg: l.weightKg,
    };
  });
}

export function toSaveInput(
  tableNumber: number,
  lines: DraftLine[],
  expectedVersion?: number,
): SaveTableOrderInput {
  return {
    tableNumber,
    expectedVersion,
    lines: lines.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      portion: l.portion,
      weightKg: l.weightKg,
    })),
  };
}

/** Same lines as saved? Drives the "unsaved changes" state of the Pay button. */
export function sameAsSaved(lines: DraftLine[], order: OrderDto | null): boolean {
  const a = lines.map((l) =>
    [l.menuItemId, l.quantity, l.portion ?? null, l.weightKg ?? null].join('|'),
  );
  const b = (order?.lines ?? []).map((l) =>
    [l.menuItemId, Number(l.quantity), l.portion ?? null, l.weightKg ?? null].join('|'),
  );
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
