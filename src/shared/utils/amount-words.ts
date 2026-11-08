import type { Language } from '@shared/types';
import { formatMoney } from './format';

/**
 * Amount in words under money fields (posgro `amountHint`), so a cashier sees 1 250 000 and
 * 125 000 apart at a glance: "1 250 000 so'm — bir million ikki yuz ellik ming". Whole so'm
 * only. Works on the digit string in groups of three, never on a float.
 */

const UZ_ONES = ['', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const UZ_TENS = [
  '',
  "o'n",
  'yigirma',
  "o'ttiz",
  'qirq',
  'ellik',
  'oltmish',
  'yetmish',
  'sakson',
  "to'qson",
];
const UZ_SCALES = ['', 'ming', 'million', 'milliard'];

const RU_ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const RU_TENS = [
  '',
  'десять',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const RU_HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];
/** one / few / many per scale; thousands are feminine. */
const RU_SCALES: Array<[string, string, string] | null> = [
  null,
  ['тысяча', 'тысячи', 'тысяч'],
  ['миллион', 'миллиона', 'миллионов'],
  ['миллиард', 'миллиарда', 'миллиардов'],
];

function uzGroup(h: number, t: number, o: number): string[] {
  const words: string[] = [];
  if (h) words.push(h === 1 ? 'yuz' : `${UZ_ONES[h]} yuz`);
  if (t) words.push(UZ_TENS[t]!);
  if (o) words.push(UZ_ONES[o]!);
  return words;
}

function ruGroup(h: number, t: number, o: number, feminine: boolean): string[] {
  const words: string[] = [];
  if (h) words.push(RU_HUNDREDS[h]!);
  if (t === 1) words.push(RU_TEENS[o]!);
  else {
    if (t) words.push(RU_TENS[t]!);
    if (o) words.push((feminine ? RU_ONES_F : RU_ONES_M)[o]!);
  }
  return words;
}

function ruPlural(t: number, o: number, [one, few, many]: [string, string, string]): string {
  if (t === 1) return many;
  if (o === 1) return one;
  return o >= 2 && o <= 4 ? few : many;
}

/** Whole part of a typed amount ("1 250 000,50" -> "1250000"), or null when it is not one. */
function wholeDigits(raw: string): string | null {
  const s = raw.replace(/\s/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.\d*)?$/.exec(s);
  return m ? m[1]!.replace(/^0+/, '') : null;
}

/** "1250000" -> words; '' for 0, and above 999 billion (no scale word for it). */
export function amountInWords(raw: string, lang: Language): string {
  const digits = wholeDigits(raw);
  if (!digits || digits.length > UZ_SCALES.length * 3) return '';
  const padded = digits.padStart(Math.ceil(digits.length / 3) * 3, '0');
  const groups = padded.match(/\d{3}/g)!;
  const words: string[] = [];
  groups.forEach((g, i) => {
    const [h, t, o] = [...g].map(Number) as [number, number, number];
    if (!h && !t && !o) return;
    const scale = groups.length - 1 - i;
    if (lang === 'uz') {
      // "ming", not "bir ming", when it leads; "bir million bir ming" inside a larger amount.
      if (i === 0 && scale === 1 && !h && !t && o === 1) words.push(UZ_SCALES[1]!);
      else words.push(...uzGroup(h, t, o), ...(scale ? [UZ_SCALES[scale]!] : []));
    } else {
      words.push(...ruGroup(h, t, o, scale === 1));
      const forms = RU_SCALES[scale];
      if (forms) words.push(ruPlural(t, o, forms));
    }
  });
  return words.join(' ');
}

/** The line under a money field: formatted amount and its words; '' when empty or 0. */
export function amountHint(raw: string, lang: Language): string {
  const digits = wholeDigits(raw);
  if (digits === null) return '';
  const value = raw.replace(/\s/g, '').replace(',', '.');
  const words = amountInWords(raw, lang);
  if (!words && !digits) return '';
  return words ? `${formatMoney(value, lang)} — ${words}` : formatMoney(value, lang);
}
