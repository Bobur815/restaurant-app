import {
  formatPhone,
  formatUzPhoneInput,
  isUzPhoneComplete,
  normalizeUzPhone,
  phoneToDigits,
} from './phone';

describe('Uzbek phone numbers', () => {
  it('finds the 9-digit subscriber number in any form', () => {
    expect(phoneToDigits('+998 (90) 123-45-67')).toBe('901234567');
    expect(phoneToDigits('998901234567')).toBe('901234567');
    expect(phoneToDigits('90 123 45 67')).toBe('901234567');
    // A number that merely starts with 99 is a subscriber number, not a country code.
    expect(phoneToDigits('991234567')).toBe('991234567');
    expect(phoneToDigits('9012')).toBe('9012');
  });

  it('normalizes complete numbers to 998XXXXXXXXX', () => {
    expect(normalizeUzPhone('+998 90 123 45 67')).toBe('998901234567');
    expect(normalizeUzPhone('901234567')).toBe('998901234567');
    expect(isUzPhoneComplete('+998 (90) 123-45-67')).toBe(true);
    expect(isUzPhoneComplete('+998 (90) 123')).toBe(false);
    expect(isUzPhoneComplete('')).toBe(false);
    // Too long or a different prefix is a typo, not a number to trim.
    expect(isUzPhoneComplete('+998 90 123 45 67 89')).toBe(false);
    expect(isUzPhoneComplete('8 90 123 45 67')).toBe(false);
    expect(isUzPhoneComplete('997901234567')).toBe(false);
  });

  it('masks while typing and formats for display', () => {
    expect(formatUzPhoneInput('')).toBe('+998 (');
    expect(formatUzPhoneInput('90')).toBe('+998 (90) ');
    expect(formatUzPhoneInput('90123')).toBe('+998 (90) 123-');
    expect(formatUzPhoneInput('901234567')).toBe('+998 (90) 123-45-67');
    expect(formatPhone('998901234567')).toBe('+998 90 123 45 67');
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('12-34')).toBe('12-34');
  });
});
