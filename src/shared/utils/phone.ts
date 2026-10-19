/**
 * Uzbek phone numbers (from posgro's phone utils). Stored as 12 digits, 998XXXXXXXXX; typed and
 * shown as +998 (90) 123-45-67; matched by the 9-digit subscriber number.
 */

export const UZ_PREFIX = '+998 (';
const SUBSCRIBER_DIGITS = 9;

export function digitsOnly(s: string | number): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** The 9-digit subscriber number from anything typed or stored (drops a leading 998). */
export function phoneToDigits(phone: string): string {
  const d = digitsOnly(phone);
  return (d.length > SUBSCRIBER_DIGITS && d.startsWith('998') ? d.slice(3) : d).slice(
    0,
    SUBSCRIBER_DIGITS,
  );
}

/**
 * A whole number and nothing more: 9 digits, or 998 + 9 digits. Extra or missing digits are a
 * mistyped number, never cut to fit (that could find someone else's record).
 */
export function isUzPhoneComplete(phone: string): boolean {
  const d = digitsOnly(phone);
  return d.length === SUBSCRIBER_DIGITS || (d.length === 12 && d.startsWith('998'));
}

/** Storage form: 998 + 9 digits. Only meaningful for a complete number. */
export function normalizeUzPhone(phone: string): string {
  return `998${phoneToDigits(phone)}`;
}

/** The input mask while typing: "+998 (90) 123-45-67", growing with the digits. */
export function formatUzPhoneInput(phone: string): string {
  const d = phoneToDigits(phone);
  const a = d.slice(0, 2);
  const b = d.slice(2, 5);
  const c = d.slice(5, 7);
  const e = d.slice(7, 9);
  let tail = a;
  if (a.length === 2) tail += ') ';
  if (b) tail = `${a}) ${b}`;
  if (b.length === 3) tail += '-';
  if (c) tail = `${a}) ${b}-${c}`;
  if (c.length === 2) tail += '-';
  if (e) tail = `${a}) ${b}-${c}-${e}`;
  return UZ_PREFIX + tail;
}

/** Display form of a stored number: "+998 90 123 45 67" (anything else is shown as stored). */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = digitsOnly(phone);
  const n = d.length === SUBSCRIBER_DIGITS ? `998${d}` : d;
  if (n.length === 12 && n.startsWith('998')) {
    return `+998 ${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8, 10)} ${n.slice(10, 12)}`;
  }
  return phone;
}
