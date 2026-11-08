/**
 * Uzbek Latin -> Cyrillic (from posgro's transliterator), used to prefill the Russian name of a
 * dish or category from the Uzbek one. Keeps letter case and leaves anything unmapped
 * (digits, punctuation, c, w) as typed. Any apostrophe form (' ` ʻ ʼ ‘ ’) works for o‘ / g‘;
 * a lone one is the tutuq belgisi (ъ).
 */

const APOSTROPHES = /['`ʻʼ‘’]/g;
const MARK = '‘';

const DIGRAPHS: Record<string, string> = {
  [`o${MARK}`]: 'ў',
  [`g${MARK}`]: 'ғ',
  sh: 'ш',
  ch: 'ч',
  ya: 'я',
  yo: 'ё',
  yu: 'ю',
  ye: 'е',
};

const LETTERS: Record<string, string> = {
  a: 'а',
  b: 'б',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'ҳ',
  i: 'и',
  j: 'ж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'қ',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  x: 'х',
  y: 'й',
  z: 'з',
  [MARK]: 'ъ',
};

export function latinToCyrillic(text: string): string {
  const src = text.replace(APOSTROPHES, MARK);
  let out = '';
  for (let i = 0; i < src.length; ) {
    let len = 2;
    let cyr = DIGRAPHS[src.slice(i, i + 2).toLowerCase()];
    if (cyr === undefined) {
      len = 1;
      const ch = src.charAt(i).toLowerCase();
      // Word-initial e is э (ertalab -> эрталаб); inside a word it is е.
      cyr = ch === 'e' && !/\p{L}/u.test(src.charAt(i - 1)) ? 'э' : LETTERS[ch];
    }
    const piece = src.slice(i, i + len);
    if (cyr === undefined) out += piece;
    else out += piece.charAt(0) !== piece.charAt(0).toLowerCase() ? cyr.toUpperCase() : cyr;
    i += len;
  }
  return out;
}
