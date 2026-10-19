import ru from './locales/ru.json';
import uz from './locales/uz.json';
import { setLanguage, t } from './index';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('translations', () => {
  it('uz and ru have exactly the same keys', () => {
    // Russian has more plural forms than Uzbek (one/few/many/other vs one/other); those count as
    // the same key. Every plural key still needs its `_other` form in both.
    const base = (list: string[]) =>
      [...new Set(list.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')))].sort();
    expect(base(keys(ru))).toEqual(base(keys(uz)));
    for (const lang of [uz, ru]) {
      const all = new Set(keys(lang));
      for (const k of all) {
        const m = /^(.*)_(zero|one|two|few|many)$/.exec(k);
        if (m) expect(all.has(`${m[1]}_other`)).toBe(true);
      }
    }
  });

  it('Russian plurals pick the right form', () => {
    setLanguage('ru');
    expect([1, 3, 5, 21].map((count) => t('halls.tables', { count }))).toEqual([
      '1 стол',
      '3 стола',
      '5 столов',
      '21 стол',
    ]);
    setLanguage('uz');
  });

  it('no empty strings', () => {
    const empty = [uz, ru].flatMap((l) =>
      keys(l).filter((k) => {
        const v = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], l);
        return v === '';
      }),
    );
    expect(empty).toEqual([]);
  });

  it('translates with interpolation and switches language', () => {
    setLanguage('uz');
    expect(t('tables.table', { n: 3 })).toBe('Stol 3');
    setLanguage('ru');
    expect(t('tables.table', { n: 3 })).toBe('Стол 3');
    expect(document.documentElement.lang).toBe('ru');
    setLanguage('uz');
  });
});
