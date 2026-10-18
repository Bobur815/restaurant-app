import { dec, type DecimalString } from '@shared/utils/decimal';
import type { Language } from '@shared/types';

/**
 * Display formatting. Not Intl: Electron's bundled ICU has no Uzbek data, so `uz-UZ` silently
 * fell back to English ("5,000", "Sun"). Numbers are formatted from the exact decimal string
 * (no float conversion): digits grouped by a no-break space, decimal comma, for both languages.
 */

const NBSP = String.fromCharCode(0xa0);
const CURRENCY: Record<Language, string> = { uz: "so'm", ru: 'сум' };

/** "1234567.5" -> "1 234 567,5" (no-break spaces), at most `maxDp` decimals, no trailing zeros. */
export function formatNumber(value: DecimalString | number, maxDp: number): string {
  const fixed = dec(value).toDecimalPlaces(maxDp).toFixed();
  const negative = fixed.startsWith('-');
  const [int = '0', frac] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${negative ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** 152500 -> "152 500 so'm" (uz) / "152 500 сум" (ru). */
export function formatMoney(
  value: DecimalString | number,
  lang: Language,
  withCurrency = true,
): string {
  const n = formatNumber(value, 2);
  return withCurrency ? `${n}${NBSP}${CURRENCY[lang]}` : n;
}

/** Quantity: up to 3 decimals; kg dishes get the unit. */
export function formatQty(
  value: DecimalString | number,
  lang: Language,
  soldByWeight = false,
): string {
  const n = formatNumber(value, 3);
  return soldByWeight ? `${n}${NBSP}${lang === 'ru' ? 'кг' : 'kg'}` : n;
}

const MONTHS: Record<Language, string[]> = {
  uz: [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avgust',
    'sentabr',
    'oktabr',
    'noyabr',
    'dekabr',
  ],
  // Genitive, as used in dates ("18 октября").
  ru: [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ],
};
const WEEKDAYS: Record<Language, string[]> = {
  uz: ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
};

const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (d: string | Date) => (typeof d === 'string' ? new Date(d) : d);

/** "20:48" */
export function formatTime(date: string | Date): string {
  const d = toDate(date);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "18.10.2026" */
export function formatDate(date: string | Date): string {
  const d = toDate(date);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** "18.10.2026 20:48" */
export function formatDateTime(date: string | Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** "18-oktabr, yakshanba" (uz) / "18 октября, воскресенье" (ru). */
export function formatLongDate(date: string | Date, lang: Language): string {
  const d = toDate(date);
  const day =
    lang === 'uz'
      ? `${d.getDate()}-${MONTHS.uz[d.getMonth()]}`
      : `${d.getDate()} ${MONTHS.ru[d.getMonth()]}`;
  return `${day}, ${WEEKDAYS[lang][d.getDay()]}`;
}

/** Uzbek in Latin script with a Russian fallback name: the name to show for a dish or category. */
export function localName(
  item: { nameUz: string; nameRu?: string | null },
  lang: Language,
): string {
  return lang === 'ru' && item.nameRu ? item.nameRu : item.nameUz;
}
