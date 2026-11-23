import { format, ruPlural, translateCount } from './index';
import { strings } from './strings';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('strings', () => {
  it('every key has Uzbek and Russian text with the same placeholders', () => {
    for (const [key, v] of Object.entries(strings)) {
      expect([key, v.uz.trim().length > 0, v.ru.trim().length > 0]).toEqual([key, true, true]);
      expect([key, placeholders(v.uz)]).toEqual([key, placeholders(v.ru)]);
    }
  });

  it('counted strings exist in all three forms', () => {
    for (const base of ['order.cart.count']) {
      for (const form of ['one', 'few', 'many']) expect(strings).toHaveProperty([`${base}_${form}`]);
    }
  });
});

describe('format and plurals', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('Stol {n}', { n: 7 })).toBe('Stol 7');
    expect(format('{a} {b}', { a: 1 })).toBe('1 {b}');
  });

  it('picks the Russian form by the number', () => {
    expect([1, 21, 2, 4, 22, 5, 11, 12, 14, 25].map(ruPlural)).toEqual([
      'one', 'one', 'few', 'few', 'few', 'many', 'many', 'many', 'many', 'many',
    ]);
    expect(translateCount('ru', 'order.cart.count', 5)).toBe('5 блюд');
    expect(translateCount('ru', 'order.cart.count', 2)).toBe('2 блюда');
    expect(translateCount('uz', 'order.cart.count', 5)).toBe('5 ta taom');
  });
});
