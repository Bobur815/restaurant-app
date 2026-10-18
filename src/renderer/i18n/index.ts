import i18next from 'i18next';
import type { Language } from '@shared/types';
import ru from './locales/ru.json';
import uz from './locales/uz.json';

/**
 * i18next core, no framework bindings. Strings are inserted with textContent or html``, which
 * escape, so i18next's own escaping is off (it would double-escape).
 */
void i18next.init({
  lng: 'uz',
  fallbackLng: 'uz',
  resources: { uz: { translation: uz }, ru: { translation: ru } },
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options) as string;
}

export function setLanguage(lang: Language): void {
  void i18next.changeLanguage(lang);
  document.documentElement.lang = lang;
}

export const currentLanguage = (): Language => (i18next.language === 'ru' ? 'ru' : 'uz');
