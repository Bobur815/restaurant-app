import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Language } from '@shared/types';
import { strings, type Locale, type StringKey } from './strings';

/**
 * The phone's own language (the PIN screen's RU/UZ chip), not the till's: each waiter reads the
 * app in theirs. Starts from the phone's system language, then remembers the choice.
 */

type Params = Record<string, string | number>;

/** `{n}` placeholders; an unknown one stays visible so a missing value is noticed. */
export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in params ? String(params[name]) : all,
  );
}

/** Russian plural form for n (one: 1, 21; few: 2-4, 22-24; many: the rest). */
export function ruPlural(n: number): 'one' | 'few' | 'many' {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

export function translate(lang: Locale, key: StringKey, params?: Params): string {
  return format(strings[key][lang], params);
}

/** A counted string: `base` + `_one` / `_few` / `_many` (Uzbek has the same text in all three). */
export function translateCount(lang: Locale, base: string, n: number, params?: Params): string {
  const key = `${base}_${lang === 'ru' ? ruPlural(n) : 'many'}` as StringKey;
  return translate(lang, key, { n, ...params });
}

const STORE_KEY = 'savdochef.language';

export function systemLanguage(): Locale {
  const code = getLocales()[0]?.languageCode;
  return code === 'ru' ? 'ru' : 'uz';
}

interface I18n {
  lang: Locale;
  setLang(lang: Locale): void;
  t(key: StringKey, params?: Params): string;
  tc(base: string, n: number, params?: Params): string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Locale>(systemLanguage);

  useEffect(() => {
    void SecureStore.getItemAsync(STORE_KEY)
      .then((saved) => {
        if (saved === 'uz' || saved === 'ru') setLangState(saved);
      })
      .catch(() => undefined);
  }, []);

  const setLang = useCallback((next: Locale) => {
    setLangState(next);
    void SecureStore.setItemAsync(STORE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      tc: (base, n, params) => translateCount(lang, base, n, params),
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** The shared formatters take the till's Language type: the same two values. */
export const asLanguage = (lang: Locale): Language => lang;
