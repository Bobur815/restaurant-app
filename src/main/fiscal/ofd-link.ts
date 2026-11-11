/**
 * Feature F18: a fiscal receipt's OFD link (`https://ofd.soliq.uz/check?t=<terminal>&r=<no>&c=
 * <yyyymmddhhmmss>&s=<sign>`), from posgro src/main/fiscal/ofd-link.ts.
 *
 * Since VCR 2026-10-30 the API answers `***` for a receipt's link, number and sign: only the paper
 * receipt has them. A refund names the sale by its link, so a check stored with `***` is refunded
 * with the link scanned off its paper receipt, after checking it is this check's receipt. The link
 * is only ever sent to VCR; SavdoChef never opens or fetches it.
 */

const OFD_LINK = /https:\/\/ofd\.soliq\.uz\/check\?[A-Za-z0-9=&%._~-]+/i;

/** The OFD link inside a value (scanner prefixes, spaces, invisible characters cut away). */
export function cleanOfdUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = OFD_LINK.exec(raw);
  return m ? m[0] : null;
}

export function isMasked(v: string | null | undefined): boolean {
  return !v || /^\*+$/.test(v.trim());
}

export function ofdLinkParts(link: string): {
  terminalId: string | null;
  receiptNo: string | null;
  fiscalSign: string | null;
  time: Date | null;
} {
  const q = new URLSearchParams(link.includes('?') ? link.slice(link.indexOf('?') + 1) : '');
  const c = q.get('c') ?? '';
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(c);
  // VCR writes its local (Tashkent) time; the till runs in the same zone.
  const time = m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : null;
  return {
    terminalId: q.get('t') || null,
    receiptNo: q.get('r') || null,
    fiscalSign: q.get('s') || null,
    time: time && !Number.isNaN(time.getTime()) ? time : null,
  };
}

/** How far VCR's receipt time may be from ours (the till stamps the answer seconds later). */
export const SCAN_TIME_TOLERANCE_MS = 5 * 60_000;

/** Why a scanned link is not this check's receipt, or null when it is. */
export function scannedLinkMismatch(
  link: string,
  check: { terminalId: string | null; fiscalAt: Date | null },
): 'terminal' | 'time' | null {
  const parts = ofdLinkParts(link);
  if (check.terminalId && !isMasked(check.terminalId) && parts.terminalId !== check.terminalId)
    return 'terminal';
  if (!parts.time || !check.fiscalAt) return 'time';
  return Math.abs(parts.time.getTime() - check.fiscalAt.getTime()) <= SCAN_TIME_TOLERANCE_MS
    ? null
    : 'time';
}
