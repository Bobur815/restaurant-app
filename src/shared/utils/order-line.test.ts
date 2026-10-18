import { LineError, priceLine } from './order-line';

const plain = { price: '12000', hasPortions: false, soldByWeight: false };
const portioned = { price: '25000', hasPortions: true, soldByWeight: false };
const byWeight = { price: '180000', hasPortions: false, soldByWeight: true }; // per kg

const strings = (l: ReturnType<typeof priceLine>) => ({
  unitPrice: l.unitPrice.toFixed(),
  totalPrice: l.totalPrice.toFixed(),
  stockQuantity: l.stockQuantity.toFixed(),
});

describe('priceLine (legacy semantics)', () => {
  it('plain dish: quantity × price, takes quantity from stock', () => {
    expect(strings(priceLine(plain, { quantity: 3 }))).toEqual({
      unitPrice: '12000',
      totalPrice: '36000',
      stockQuantity: '3',
    });
  });

  it('portion dish: quantity × factor for price and stock', () => {
    expect(strings(priceLine(portioned, { quantity: 3, portion: '0.7' }))).toEqual({
      unitPrice: '17500',
      totalPrice: '52500',
      stockQuantity: '2.1',
    });
    expect(strings(priceLine(portioned, { quantity: 2, portion: '0.5' }))).toEqual({
      unitPrice: '12500',
      totalPrice: '25000',
      stockQuantity: '1',
    });
    // Missing portion means a full portion.
    expect(priceLine(portioned, { quantity: 1 }).portion?.toFixed()).toBe('1');
  });

  it('weight dish: price per kg × kg per unit × units; stock in kg', () => {
    // 2 skewers of 0.25 kg at 180 000 so'm/kg
    expect(strings(priceLine(byWeight, { quantity: 2, weightKg: '0.25' }))).toEqual({
      unitPrice: '45000',
      totalPrice: '90000',
      stockQuantity: '0.5',
    });
  });

  it('rounds the total once from the unrounded product (no per-unit rounding drift)', () => {
    const odd = { price: '10000.005', hasPortions: false, soldByWeight: true };
    const line = priceLine(odd, { quantity: 3, weightKg: '0.333' });
    // 10000.005 × 0.333 = 3330.001665 → unit 3330; × 3 = 9990.004995 → 9990
    expect(line.unitPrice.toFixed()).toBe('3330');
    expect(line.totalPrice.toFixed()).toBe('9990');
  });

  it.each([
    [plain, { quantity: 0 }, 'quantity'],
    [plain, { quantity: 1.5 }, 'quantity'],
    [plain, { quantity: -1 }, 'quantity'],
    [plain, { quantity: 1, weightKg: '1' }, 'weightKg'],
    [plain, { quantity: 1, portion: '0.5' }, 'portion'],
    [portioned, { quantity: 1, portion: '0.6' }, 'portion'],
    [byWeight, { quantity: 1 }, 'weightKg'],
    [byWeight, { quantity: 1, weightKg: '0' }, 'weightKg'],
    [byWeight, { quantity: 1, weightKg: '0.2', portion: '1' }, 'portion'],
  ] as const)('rejects invalid input %#', (dish, line, field) => {
    expect(() => priceLine(dish, line)).toThrow(LineError);
    try {
      priceLine(dish, line);
    } catch (e) {
      expect((e as LineError).field).toBe(field);
    }
  });
});
