import type { AppSettings, MenuItemDto, OrderDto, SessionDto } from '@shared/types';
import { addDish, fromOrder, setPortion, setQuantity } from '@shared/utils/order-draft';
import { isNewLine, itemCount, minutesSince, newLineCount, nextWeightInput, stockTag, totals, weightText } from './cart';

const dish = (over: Partial<MenuItemDto>): MenuItemDto => ({
  id: 1,
  nameUz: 'Lavash',
  nameRu: null,
  description: null,
  price: '32000',
  costPrice: null,
  imageFile: null,
  categoryId: 1,
  categoryNameUz: 'Lavash',
  hasPortions: false,
  soldByWeight: false,
  isActive: true,
  printerId: null,
  mxik: null,
  packageCode: null,
  ...over,
});
const lavash = dish({});
const osh = dish({ id: 2, nameUz: 'Osh', price: '45000', hasPortions: true });
const kabob = dish({ id: 3, nameUz: 'Kabob', price: '120000', soldByWeight: true });

const settings = (over: Partial<AppSettings>): AppSettings =>
  ({ serviceFeeType: 'off', serviceFeePercent: '0', serviceFeePerGuest: '0', ...over }) as AppSettings;

const savedOrder = (lines: { menuItemId: number; quantity: string; portion?: string | null; weightKg?: string | null }[]): OrderDto =>
  ({
    id: 1,
    version: 3,
    lines: lines.map((l, i) => ({
      id: i + 1,
      menuItemId: l.menuItemId,
      nameUz: 'x',
      nameRu: null,
      imageFile: null,
      soldByWeight: (l.weightKg ?? null) !== null,
      hasPortions: (l.portion ?? null) !== null,
      quantity: l.quantity,
      portion: l.portion ?? null,
      weightKg: l.weightKg ?? null,
      unitPrice: '0',
      totalPrice: '0',
      stockQuantity: l.weightKg ?? l.portion ?? l.quantity,
    })),
  }) as unknown as OrderDto;

describe('cart', () => {
  it('totals with the service fee as main works it out (percent and per guest)', () => {
    let lines = addDish([], lavash);
    lines = setQuantity(lines, lines[0]!.key, 2); // 64 000
    lines = addDish(lines, kabob, '0.45'); // 54 000
    expect(totals(lines, settings({}), null)).toEqual({ dishes: '118000', fee: '0', total: '118000' });
    expect(totals(lines, settings({ serviceFeeType: 'percent', serviceFeePercent: '10' }), 4)).toEqual({
      dishes: '118000',
      fee: '11800',
      total: '129800',
    });
    expect(totals(lines, settings({ serviceFeeType: 'perGuest', serviceFeePerGuest: '5000' }), 4).fee).toBe('20000');
    // An empty order carries no fee.
    expect(totals([], settings({ serviceFeeType: 'perGuest', serviceFeePerGuest: '5000' }), 4).fee).toBe('0');
  });

  it('marks lines the till does not have yet as new', () => {
    const order = savedOrder([{ menuItemId: 1, quantity: '2' }, { menuItemId: 2, quantity: '1', portion: '1' }]);
    let lines = fromOrder(order, [lavash, osh]);
    expect(lines.map((l) => isNewLine(l, order))).toEqual([false, false]);
    lines = setQuantity(lines, lines[0]!.key, 3); // more than saved
    const fresh = addDish([], osh);
    lines = [...lines, ...setPortion(fresh, fresh[0]!.key, '0.7')]; // another portion
    expect(lines.map((l) => isNewLine(l, order))).toEqual([true, false, true]);
    expect(newLineCount(lines, order)).toBe(2);
    expect(isNewLine(lines[0]!, null)).toBe(true);
  });

  it('counts pieces, a weight line as one', () => {
    let lines = addDish([], lavash);
    lines = setQuantity(lines, lines[0]!.key, 3);
    lines = addDish(lines, kabob, '0.45');
    expect(itemCount(lines)).toBe(4);
  });

  it('tags low and sold-out dishes from the shift, counting this order', () => {
    const session = {
      items: [
        { menuItemId: 1, remainingQuantity: '3', unlimited: false },
        { menuItemId: 2, remainingQuantity: '40', unlimited: false },
        { menuItemId: 3, remainingQuantity: '0', unlimited: true },
      ],
    } as unknown as SessionDto;
    expect(stockTag(1, session, null, [])).toEqual({ kind: 'low', left: '3' });
    expect(stockTag(2, session, null, [])).toBeNull();
    expect(stockTag(3, session, null, [])).toBeNull(); // unlimited
    expect(stockTag(9, session, null, [])).toEqual({ kind: 'out' }); // not in the shift
    let lines = addDish([], lavash);
    lines = setQuantity(lines, lines[0]!.key, 3);
    expect(stockTag(1, session, null, lines)).toEqual({ kind: 'out' });
    // What this order already holds comes back to it.
    expect(stockTag(1, session, savedOrder([{ menuItemId: 1, quantity: '2' }]), lines)).toEqual({ kind: 'low', left: '2' });
  });

  it('shows weights with a comma and three places; minutes never go negative', () => {
    expect(weightText('0.45')).toBe('0,450');
    expect(weightText('1.2345')).toBe('1,235');
    const now = new Date('2026-11-22T10:45:00Z');
    expect(minutesSince('2026-11-22T10:00:00Z', now)).toBe(45);
    expect(minutesSince('2026-11-22T10:50:00Z', now)).toBe(0);
  });
});

describe('weight keypad', () => {
  it('takes digits, one comma and at most 3 decimals', () => {
    const typed = (keys: string) => [...keys].reduce(nextWeightInput, '');
    expect(typed('0,450')).toBe('0,450');
    expect(typed(',5')).toBe('0,5');
    expect(typed('0,4505')).toBe('0,450');
    expect(typed('1,,2')).toBe('1,2');
    expect(typed('123')).toBe('12');
  });
});
