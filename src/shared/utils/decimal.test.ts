import {
  dec,
  isDecimalString,
  roundMoney,
  roundQty,
  sum,
  toMoneyString,
  toQtyString,
} from './decimal';

describe('dec', () => {
  it('accepts decimal strings, finite numbers and objects with a decimal toString', () => {
    expect(dec('12500.50').toFixed()).toBe('12500.5');
    expect(dec(0.7).toFixed()).toBe('0.7');
    expect(dec({ toString: () => '3.25' }).toFixed()).toBe('3.25');
  });

  it.each(['', ' 1', '1e5', 'NaN', 'Infinity', '1,5', '0x10', '.5', '5.'])('rejects %p', (bad) => {
    expect(() => dec(bad)).toThrow();
  });

  it('rejects non-finite numbers and missing values', () => {
    expect(() => dec(Number.NaN)).toThrow();
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => dec(null as unknown as string)).toThrow();
  });
});

describe('rounding rule', () => {
  it('money: 2 dp, half up', () => {
    expect(toMoneyString('0.005')).toBe('0.01');
    expect(toMoneyString('2.345')).toBe('2.35');
    expect(toMoneyString('-2.345')).toBe('-2.35');
    expect(toMoneyString('12000')).toBe('12000');
  });

  it('quantities: 3 dp, half up', () => {
    expect(toQtyString('1.2345')).toBe('1.235');
    expect(toQtyString('0.0004')).toBe('0');
  });

  it('avoids float error that Number math has', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(dec('0.1').plus('0.2').toFixed()).toBe('0.3');
    // 3 portions of 0.7 of a 25 000 so'm dish
    expect(toMoneyString(dec('25000').times('0.7').times(3))).toBe('52500');
  });

  it('never prints exponent notation for large or tiny values', () => {
    expect(toMoneyString('123456789012345.67')).toBe('123456789012345.67');
    expect(roundQty('0.0000001').toFixed()).toBe('0');
    expect(roundMoney('0.0000001').toFixed()).toBe('0');
  });
});

describe('helpers', () => {
  it('sum adds mixed inputs exactly', () => {
    expect(sum(['0.1', '0.2', 0.3, { toString: () => '0.4' }]).toFixed()).toBe('1');
    expect(sum([]).toFixed()).toBe('0');
  });

  it('isDecimalString matches what dec accepts', () => {
    expect(isDecimalString('-12.5')).toBe(true);
    expect(isDecimalString('1e3')).toBe(false);
    expect(isDecimalString(12)).toBe(false);
  });
});
