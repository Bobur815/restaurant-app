import { isPrivateIPv4, WAITER_PROTOCOL, waiterPairingQr, type PairRefusal } from '@shared/lan-waiter';
import { baseUrl, credentialSchema, type Credential } from './credential';

/**
 * Pairing with a till (Connect screen): from the QR the till shows in Settings -> Yo'ldosh
 * kassalar -> Telefon qo'shish, or from the address and the 6-digit code typed by hand.
 */

export const DEFAULT_PORT = 5180;

export interface PairTarget {
  hosts: string[];
  port: number;
  code: string;
}

/** The till's QR (JSON, `app: 'savdochef-waiter'`), or null for any other QR. */
export function parsePairingQr(text: string): PairTarget | null {
  try {
    const parsed = waiterPairingQr.safeParse(JSON.parse(text));
    return parsed.success
      ? { hosts: parsed.data.hosts, port: parsed.data.port, code: parsed.data.code }
      : null;
  } catch {
    return null;
  }
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** "192.168.1.10" or "192.168.1.10:5180" (spaces ignored) -> host and port; null when not that. */
export function parseAddress(text: string): { host: string; port: number } | null {
  const clean = text.replace(/\s+/g, '');
  const m = /^([\d.]+)(?::(\d{1,5}))?$/.exec(clean);
  if (!m || !IPV4.test(m[1]!) || !isPrivateIPv4(m[1]!)) return null;
  const port = m[2] ? Number(m[2]) : DEFAULT_PORT;
  if (port < 1024 || port > 65535) return null;
  return { host: m[1]!, port };
}

export const isPairingCode = (code: string) => /^\d{6}$/.test(code);

/** Why pairing failed: one card per reason on the Connect screen. */
export type PairFailure =
  | { kind: 'wrong' }
  | { kind: 'expired' }
  | { kind: 'throttled' }
  | { kind: 'wrongKind' }
  | { kind: 'notFound' }
  | { kind: 'plan' }
  | { kind: 'limit'; message: string }
  | { kind: 'version' }
  | { kind: 'other'; message: string };

export type PairResult = { ok: true; credential: Credential } | { ok: false; failure: PairFailure };

const PAIR_TIMEOUT_MS = 6_000;

const REFUSAL: Record<PairRefusal, PairFailure['kind']> = {
  wrong: 'wrong',
  expired: 'expired',
  throttled: 'throttled',
  kind: 'wrongKind',
  plan: 'plan',
};

/**
 * Asks each address in turn (the till may have several networks) until one answers. The kind is
 * always "phone": a till code typed here is refused by the till, never turned into a till.
 */
export async function pair(
  target: PairTarget,
  phoneName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PairResult> {
  for (const host of target.hosts) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PAIR_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl(host, target.port)}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: target.code, name: phoneName, expect: 'waiter' }),
        signal: ctl.signal,
      });
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) {
      if (body['kind'] !== 'waiter' || body['protocol'] !== WAITER_PROTOCOL) {
        return { ok: false, failure: { kind: 'version' } };
      }
      const credential = credentialSchema.safeParse({
        // The address that answered first, then the others the till gave.
        hosts: [host, ...target.hosts.filter((h) => h !== host)],
        port: target.port,
        deviceId: body['deviceId'],
        secret: body['secret'],
        lineage: body['lineage'],
        restaurantName: typeof body['restaurantName'] === 'string' ? body['restaurantName'] : '',
        tillVersion: typeof body['version'] === 'string' ? body['version'] : '',
        pairedAt: new Date().toISOString(),
      });
      // Not what a SavdoChef till answers: nothing is stored.
      if (!credential.success) return { ok: false, failure: { kind: 'version' } };
      return { ok: true, credential: credential.data };
    }
    const reason = body['reason'];
    if (typeof reason === 'string' && reason in REFUSAL) {
      return { ok: false, failure: { kind: REFUSAL[reason as PairRefusal] } as PairFailure };
    }
    // 409: an AppError (the plan's phones are all taken), with main's Uzbek message.
    const error = body['error'];
    if (res.status === 409 && error && typeof error === 'object') {
      const e = error as { message?: string; details?: { reason?: string } };
      if (e.details?.reason === 'DEVICE_LIMIT')
        return { ok: false, failure: { kind: 'limit', message: e.message ?? '' } };
      return { ok: false, failure: { kind: 'other', message: e.message ?? '' } };
    }
    // A till from before F20-W answers without a reason: its message is still Uzbek and true.
    if (typeof error === 'string') return { ok: false, failure: { kind: 'other', message: error } };
    return { ok: false, failure: { kind: 'other', message: `HTTP ${res.status}` } };
  }
  return { ok: false, failure: { kind: 'notFound' } };
}
