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
    expect(keys(ru).sort()).toEqual(keys(uz).sort());
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
