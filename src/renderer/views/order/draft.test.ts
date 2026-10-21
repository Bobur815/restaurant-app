import type { MenuItemDto, OrderDto, SessionDto } from '@shared/types';
import {
  addDish,
  available,
  UNLIMITED,
  draftTotal,
  draftUsage,
  fromOrder,
  removeLine,
  sameAsSaved,
  savedUsage,
  setPortion,
  setQuantity,
  toSaveInput,
} from './draft';

const dish = (over: Partial<MenuItemDto>): MenuItemDto => ({
  id: 1,
  nameUz: 'Non',
  nameRu: null,
  description: null,
  price: '5000',
  costPrice: null,
  imageFile: null,
  categoryId: 1,
  categoryNameUz: 'Ovqatlar',
  hasPortions: false,
  soldByWeight: false,
  isActive: true,
  ...over,
});
const non = dish({});
const osh = dish({ id: 2, nameUz: 'Osh', price: '25000', hasPortions: true });
const shashlik = dish({ id: 3, nameUz: 'Shashlik', price: '180000', soldByWeight: true });

describe('order draft', () => {
  it('adding the same plain dish or full portion bumps the line; weight dishes get new lines', () => {
    let lines = addDish([], non);
    lines = addDish(lines, non);
    lines = addDish(lines, osh);
    lines = setPortion(lines, lines[1]!.key, '0.5');
    lines = addDish(lines, osh); // a full portion: new line, the half stays separate
    lines = addDish(lines, shashlik, '0.25');
    lines = addDish(lines, shashlik, '0.3');
    expect(lines.map((l) => [l.nameUz, l.quantity, l.portion, l.weightKg])).toEqual([
      ['Non', 2, null, null],
      ['Osh', 1, '0.5', null],
      ['Osh', 1, '1', null],
      ['Shashlik', 1, null, '0.25'],
      ['Shashlik', 1, null, '0.3'],
    ]);
    // 10 000 + 12 500 + 25 000 + 45 000 + 54 000
    expect(draftTotal(lines)).toBe('146500');
    expect(() => addDish(lines, shashlik)).toThrow();
  });

  it('quantity is clamped to whole numbers 1..999', () => {
    const [l] = addDish([], non);
    expect(setQuantity([l!], l!.key, 0)[0]!.quantity).toBe(1);
    expect(setQuantity([l!], l!.key, 2.7)[0]!.quantity).toBe(2);
    expect(setQuantity([l!], l!.key, 5000)[0]!.quantity).toBe(999);
    expect(removeLine([l!], l!.key)).toEqual([]);
  });

  it('availability = shift remaining + what this order holds - the draft', () => {
    const session = {
      items: [{ menuItemId: 2, remainingQuantity: '3' }],
    } as unknown as SessionDto;
    const order = { lines: [{ menuItemId: 2, stockQuantity: '1.5' }] } as unknown as OrderDto;
    let lines = addDish([], osh);
    lines = setQuantity(lines, lines[0]!.key, 4); // 4 full portions
    expect(available(2, session, savedUsage(order), draftUsage(lines))).toBe('0.5');
    expect(available(1, session, savedUsage(order), draftUsage(lines))).toBeNull();
  });

  it('an unlimited (∞) dish is always available, whatever the draft holds', () => {
    const session = {
      items: [{ menuItemId: 2, remainingQuantity: '0', unlimited: true }],
    } as unknown as SessionDto;
    let lines = addDish([], osh);
    lines = setQuantity(lines, lines[0]!.key, 500);
    expect(available(2, session, savedUsage(null), draftUsage(lines))).toBe(UNLIMITED);
  });

  it('round-trips a saved order and detects unsaved changes', () => {
    const order = {
      lines: [
        {
          menuItemId: 2,
          nameUz: 'Osh',
          nameRu: null,
          imageFile: null,
          unitPrice: '17500',
          quantity: '2',
          portion: '0.7',
          weightKg: null,
          hasPortions: true,
          soldByWeight: false,
          stockQuantity: '1.4',
        },
      ],
    } as unknown as OrderDto;
    const lines = fromOrder(order, [osh]);
    expect(sameAsSaved(lines, order)).toBe(true);
    expect(sameAsSaved(setQuantity(lines, lines[0]!.key, 3), order)).toBe(false);
    expect(toSaveInput(4, lines, 2)).toEqual({
      tableNumber: 4,
      expectedVersion: 2,
      lines: [{ menuItemId: 2, quantity: 2, portion: '0.7', weightKg: null }],
    });
  });
});
