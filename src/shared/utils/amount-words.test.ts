import { amountHint, amountInWords } from './amount-words';

describe('amount in words', () => {
  it('reads Uzbek', () => {
    expect(amountInWords('1', 'uz')).toBe('bir');
    expect(amountInWords('11', 'uz')).toBe("o'n bir");
    expect(amountInWords('100', 'uz')).toBe('yuz');
    expect(amountInWords('305', 'uz')).toBe('uch yuz besh');
    expect(amountInWords('1000', 'uz')).toBe('ming');
    expect(amountInWords('21000', 'uz')).toBe('yigirma bir ming');
    expect(amountInWords('1250000', 'uz')).toBe('bir million ikki yuz ellik ming');
    expect(amountInWords('12000000', 'uz')).toBe("o'n ikki million");
    expect(amountInWords('1001000', 'uz')).toBe('bir million bir ming');
    expect(amountInWords('2000000001', 'uz')).toBe('ikki milliard bir');
  });

  it('reads Russian with gender and plural forms', () => {
    expect(amountInWords('1', 'ru')).toBe('один');
    expect(amountInWords('11', 'ru')).toBe('одиннадцать');
    expect(amountInWords('1000', 'ru')).toBe('одна тысяча');
    expect(amountInWords('2000', 'ru')).toBe('две тысячи');
    expect(amountInWords('5000', 'ru')).toBe('пять тысяч');
    expect(amountInWords('11000', 'ru')).toBe('одиннадцать тысяч');
    expect(amountInWords('21000', 'ru')).toBe('двадцать одна тысяча');
    expect(amountInWords('1250000', 'ru')).toBe('один миллион двести пятьдесят тысяч');
    expect(amountInWords('3000000000', 'ru')).toBe('три миллиарда');
  });

  it('takes what a cashier types and ignores the fraction', () => {
    expect(amountInWords('1 250 000', 'uz')).toBe('bir million ikki yuz ellik ming');
    expect(amountInWords('15000,50', 'uz')).toBe("o'n besh ming");
    expect(amountInWords('0', 'uz')).toBe('');
    expect(amountInWords('', 'uz')).toBe('');
    expect(amountInWords('12a', 'uz')).toBe('');
    expect(amountInWords('1000000000000', 'uz')).toBe('');
  });

  it('builds the hint line', () => {
    expect(amountHint('1250000', 'uz')).toMatch(
      /^1\s250\s000\sso'm — bir million ikki yuz ellik ming$/,
    );
    expect(amountHint('5000', 'ru')).toMatch(/^5\s000\sсум — пять тысяч$/);
    expect(amountHint('', 'uz')).toBe('');
    expect(amountHint('0', 'uz')).toBe('');
    expect(amountHint('abc', 'uz')).toBe('');
  });
});
