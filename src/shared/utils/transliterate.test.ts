import { latinToCyrillic } from './transliterate';

describe('Uzbek Latin -> Cyrillic', () => {
  it('maps letters and digraphs, keeping case', () => {
    expect(latinToCyrillic('Osh')).toBe('Ош');
    expect(latinToCyrillic('Choy qora')).toBe('Чой қора');
    expect(latinToCyrillic('SHASHLIK')).toBe('ШАШЛИК');
    expect(latinToCyrillic('Yupqa non')).toBe('Юпқа нон');
    expect(latinToCyrillic('Yer yong‘oq')).toBe('Ер ёнғоқ');
  });

  it('accepts any apostrophe for o‘ / g‘ and turns a lone one into ъ', () => {
    expect(latinToCyrillic("Go'sht")).toBe('Гўшт');
    expect(latinToCyrillic('Goʻsht')).toBe('Гўшт');
    expect(latinToCyrillic('O`rama')).toBe('Ўрама');
    expect(latinToCyrillic("Ma'no")).toBe('Маъно');
  });

  it('uses э at the start of a word only', () => {
    expect(latinToCyrillic('Ertalabki non')).toBe('Эрталабки нон');
    expect(latinToCyrillic('Lagmon (2-son)')).toBe('Лагмон (2-сон)');
  });

  it('leaves unmapped characters as typed', () => {
    expect(latinToCyrillic('Coca-Cola 0,5')).toBe('Cоcа-Cола 0,5');
    expect(latinToCyrillic('')).toBe('');
  });
});
