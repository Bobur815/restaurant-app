import {
  formatAgo,
  formatDateTime,
  formatLongDate,
  formatMoney,
  formatNumber,
  formatQty,
  localName,
} from './format';

const NBSP = String.fromCharCode(0xa0);
const plain = (s: string) => s.split(NBSP).join(' ');

describe('format', () => {
  it('money: space-grouped digits, decimal comma, currency per language', () => {
    expect(plain(formatMoney('152500', 'uz'))).toBe("152 500 so'm");
    expect(plain(formatMoney('152500', 'ru'))).toBe('152 500 сум');
    expect(plain(formatMoney('1234567.5', 'uz', false))).toBe('1 234 567,5');
    expect(formatMoney('0.5', 'uz', false)).toBe('0,5');
    expect(plain(formatMoney('-12000', 'uz', false))).toBe('-12 000');
  });

  it('groups with no-break spaces so amounts never wrap mid-number', () => {
    expect(formatNumber('79600', 2)).toBe(`79${NBSP}600`);
  });

  it('formats from the exact decimal string (no float rounding)', () => {
    expect(plain(formatNumber('123456789012345.67', 2))).toBe('123 456 789 012 345,67');
    expect(formatNumber('0.1', 2)).toBe('0,1');
  });

  it('quantities: up to 3 decimals, kg only for weight dishes', () => {
    expect(formatQty('2.1', 'uz')).toBe('2,1');
    expect(plain(formatQty('0.25', 'ru', true))).toBe('0,25 кг');
    expect(plain(formatQty('2.75', 'uz', true))).toBe('2,75 kg');
  });

  it('dates in Uzbek and Russian without relying on ICU locale data', () => {
    const d = new Date(2026, 9, 18, 20, 48); // Sunday
    expect(formatLongDate(d, 'uz')).toBe('18-oktabr, yakshanba');
    expect(formatLongDate(d, 'ru')).toBe('18 октября, воскресенье');
    expect(formatDateTime(d)).toBe('18.10.2026 20:48');
  });

  it('localName falls back to Uzbek when there is no Russian name', () => {
    expect(localName({ nameUz: 'Osh', nameRu: 'Плов' }, 'ru')).toBe('Плов');
    expect(localName({ nameUz: 'Osh', nameRu: null }, 'ru')).toBe('Osh');
    expect(localName({ nameUz: 'Osh', nameRu: 'Плов' }, 'uz')).toBe('Osh');
  });
});

describe('formatAgo', () => {
  const now = new Date(2026, 10, 22, 12, 0, 0);
  const back = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;

  it('says now under a minute, and for a time ahead of this clock', () => {
    expect(formatAgo(back(59_000), now, 'uz')).toBe('hozir');
    expect(formatAgo(back(-5 * MIN), now, 'uz')).toBe('hozir');
    expect(formatAgo(back(0), now, 'ru')).toBe('только что');
  });

  it('counts minutes, then hours', () => {
    expect(formatAgo(back(MIN), now, 'uz')).toBe('1 daqiqa oldin');
    expect(formatAgo(back(59 * MIN), now, 'uz')).toBe('59 daqiqa oldin');
    expect(formatAgo(back(60 * MIN), now, 'uz')).toBe('1 soat oldin');
    expect(formatAgo(back(23 * 60 * MIN + 59 * MIN), now, 'ru')).toBe('23 ч назад');
    expect(formatAgo(back(5 * MIN), now, 'ru')).toBe('5 мин назад');
  });

  it('gives the date and time from a day back', () => {
    const d = back(24 * 60 * MIN);
    expect(formatAgo(d, now, 'uz')).toBe(formatDateTime(d));
    expect(formatAgo(d.toISOString(), now, 'ru')).toBe(formatDateTime(d));
  });
});
